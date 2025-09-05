from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv
import base64
import socketio
import uvicorn
import os

load_dotenv()

# ----------------------------
# FastAPI
# ----------------------------
app = FastAPI()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://chitchat-ji1p.onrender.com")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Socket.IO
# ----------------------------
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[FRONTEND_ORIGIN],
)
socket_app = socketio.ASGIApp(sio, app)

# ----------------------------
# MongoDB
# ----------------------------
if not MONGO_URI:
    raise RuntimeError("MONGO_URI is not set. Put it in your environment or .env")

client = AsyncIOMotorClient(MONGO_URI)
db = client["chatting_db"]

# ----------------------------
# Auth / Security
# ----------------------------
SECRET_KEY = os.getenv("SECRET_KEY", "my_chatting_gone")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="signin")

# username -> sid
connected_users: Dict[str, str] = {}

# ----------------------------
# Models
# ----------------------------
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class MessageInput(BaseModel):
    text: str
    image: Optional[str] = None

class RequestAction(BaseModel):
    requesterUsername: str

class FriendRequest(BaseModel):
    toUsername: str

# ----------------------------
# Helpers
# ----------------------------
def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

async def get_current_user(token: str = Depends(oauth2_scheme)) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user.pop("password", None)
    return user

async def emit_to_user(username: str, event: str, data: Any):
    sid = connected_users.get(username)
    if sid:
        await sio.emit(event, data, to=sid)

async def emit_to_all(event: str, data: Any):
    # Broadcast to all connected sockets
    await sio.emit(event, data)

# ----------------------------
# Socket.IO Events
# ----------------------------
@sio.event
async def connect(sid, environ, auth):
    token = auth.get("token") if auth else None
    if not token:
        await sio.disconnect(sid)
        return
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            await sio.disconnect(sid)
            return
        user = await db.users.find_one({"email": email})
        if not user:
            await sio.disconnect(sid)
            return
        username = user["username"]
        connected_users[username] = sid
        # Send initial counters upon connect
        requests = user.get("requests", [])
        await emit_to_user(username, "notifications:count", {"count": len(requests)})
    except JWTError:
        await sio.disconnect(sid)

@sio.event
async def disconnect(sid):
    to_remove = None
    for uname, socket_id in connected_users.items():
        if socket_id == sid:
            to_remove = uname
            break
    if to_remove:
        del connected_users[to_remove]

@sio.event
async def user_connected(sid, data):
    username = data.get("username")
    if username:
        connected_users[username] = sid

# Mark chat as read from client
@sio.event
async def chat_read(sid, data):
    me = data.get("me")
    friend = data.get("friend")
    if not me or not friend:
        return
    # mark messages as read in DB
    user_doc = await db.users.find_one({"username": me})
    if not user_doc:
        return

    updated = False
    for f in user_doc.get("friends", []):
        if f.get("name") == friend:
            for m in f.get("messages", []):
                if m.get("type") == "received" and m.get("status") == "unread":
                    m["status"] = "read"
                    updated = True
            break
    if updated:
        await db.users.replace_one({"_id": user_doc["_id"]}, user_doc)

    # Emit unseen reset for this chat to the reader
    await emit_to_user(me, "chat:unseen_update", {"friendUsername": friend, "unseenCount": 0})

# ----------------------------
# REST: Health
# ----------------------------
@app.get("/ping")
async def ping():
    return {"message": "pong"}

# ----------------------------
# REST: Auth
# ----------------------------
@app.post("/signup")
async def signup(user: UserCreate):
    if await db.users.find_one({"email": user.email}) or await db.users.find_one({"username": user.username}):
        raise HTTPException(status_code=400, detail="Email or Username already exists")
    hashed_pw = get_password_hash(user.password)
    await db.users.insert_one({
        "username": user.username,
        "email": user.email,
        "password": hashed_pw,
        "requests": [],
        "friends": [],
        "profile": ""
    })

    # Emit to all connected clients that a new user was created
    await emit_to_all("user:created", {"username": user.username, "profile": ""})

    return {"message": "User created successfully"}

@app.post("/signin", response_model=Token)
async def signin(user: UserLogin):
    db_user = await db.users.find_one({"email": user.email})
    if not db_user or not verify_password(user.password, db_user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": db_user["email"]})
    return {"access_token": token, "token_type": "bearer"}

# ----------------------------
# REST: Profile & User Info
# ----------------------------
@app.get("/me")
async def me(current_user=Depends(get_current_user)):
    return {
        "username": current_user["username"],
        "email": current_user["email"],
        "requests": current_user.get("requests", []),
        "friends": current_user.get("friends", []),
        "profile": current_user.get("profile", "")
    }

@app.post("/profile/upload")
async def upload_profile_image(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    content = await file.read()
    encoded = base64.b64encode(content).decode()
    await db.users.update_one({"email": current_user["email"]}, {"$set": {"profile": encoded}})

    # Broadcast profile update to everyone so frontends update images in real-time.
    await emit_to_all("profile:updated", {"username": current_user["username"], "profile": encoded})

    return {"message": "Profile image uploaded"}

@app.get("/him")
async def get_him_profile(name: str, current_user=Depends(get_current_user)):
    friend = await db.users.find_one({"username": name})
    if not friend:
        raise HTTPException(status_code=404, detail="Friend not found")
    return {"name": friend["username"], "profile": friend.get("profile", "")}

# New endpoint: fetch all users (username, email, profile)
@app.get("/users")
async def get_all_users(current_user=Depends(get_current_user)):
    # return a list of users with limited fields (no password)
    users = await db.users.find({}, {"password": 0}).to_list(length=200)
    # Clean up documents to only include what frontend needs
    result = []
    for u in users:
        result.append({
            "username": u.get("username"),
            "email": u.get("email"),
            "profile": u.get("profile", "")
        })
    return result

@app.get("/users/search")
async def search_users(q: str, current_user=Depends(get_current_user)):
    all_users = await db.users.find({"username": {"$regex": q, "$options": "i"}}).to_list(20)
    return [
        {"username": u["username"], "email": u["email"], "profile": u.get("profile", "")}
        for u in all_users if u["email"] != current_user["email"]
    ]

# ----------------------------
# REST: Friend Requests
# ----------------------------
@app.get("/notifications/count")
async def notif_count(current_user=Depends(get_current_user)):
    return {"count": len(current_user.get("requests", []))}

@app.post("/requests")
async def send_request(data: FriendRequest, current_user=Depends(get_current_user)):
    if data.toUsername == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot send request to yourself")
    target = await db.users.find_one({"username": data.toUsername})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    await db.users.update_one(
        {"username": data.toUsername},
        {"$addToSet": {"requests": current_user["username"]}}
    )

    # realtime notification counter to receiver
    target_after = await db.users.find_one({"username": data.toUsername})
    await emit_to_user(
        data.toUsername,
        "notifications:count",
        {"count": len(target_after.get("requests", []))}
    )

    # (Optional) notify receiver who sent it
    await emit_to_user(
        data.toUsername,
        "request:new",
        {"from": current_user["username"]}
    )
    return {"message": "Request sent"}

@app.post("/requests/accept")
async def accept_request(data: RequestAction, current_user=Depends(get_current_user)):
    requester = await db.users.find_one({"username": data.requesterUsername})
    if not requester:
        raise HTTPException(status_code=404, detail="Requester not found")

    # remove from both requests arrays (in case both sent)
    await db.users.update_one({"username": current_user["username"]}, {"$pull": {"requests": data.requesterUsername}})
    await db.users.update_one({"username": data.requesterUsername}, {"$pull": {"requests": current_user["username"]}})

    # add each other as friends if not already
    await db.users.update_one(
        {"username": current_user["username"]},
        {"$addToSet": {"friends": {"name": requester["username"], "messages": []}}}
    )
    await db.users.update_one(
        {"username": data.requesterUsername},
        {"$addToSet": {"friends": {"name": current_user["username"], "messages": []}}}
    )

    # realtime: decrement counter for current user (their requests list changed)
    me_after = await db.users.find_one({"username": current_user["username"]})
    await emit_to_user(
        current_user["username"],
        "notifications:count",
        {"count": len(me_after.get("requests", []))}
    )

    # realtime: both should see each other in chats
    await emit_to_user(current_user["username"], "friend:added", {"friendUsername": requester["username"]})
    await emit_to_user(requester["username"], "friend:added", {"friendUsername": current_user["username"]})

    return {"message": "Friend added"}

@app.post("/requests/reject")
async def reject_request(data: RequestAction, current_user=Depends(get_current_user)):
    await db.users.update_one({"username": current_user["username"]}, {"$pull": {"requests": data.requesterUsername}})
    me_after = await db.users.find_one({"username": current_user["username"]})
    await emit_to_user(
        current_user["username"],
        "notifications:count",
        {"count": len(me_after.get("requests", []))}
    )
    return {"message": "Request rejected"}

# ----------------------------
# REST: Chats
# ----------------------------
@app.get("/{username}/chats")
async def get_chats(username: str, current_user=Depends(get_current_user)):
    if username != current_user["username"]:
        raise HTTPException(status_code=403, detail="Unauthorized")

    chats = []
    for friend in current_user.get("friends", []):
        messages = friend.get("messages", [])
        unseen = sum(1 for m in messages if m.get("type") == "received" and m.get("status") == "unread")
        chats.append({"friendUsername": friend["name"], "unseenCount": unseen})
    # sort by last message time desc (optional)
    def last_time(fmsgs: List[dict]):
        if not fmsgs:
            return ""
        return max(m.get("time", "") for m in fmsgs)
    chats.sort(key=lambda c: last_time(next((f["messages"] for f in current_user.get("friends", []) if f["name"] == c["friendUsername"]), [])), reverse=True)
    return chats

@app.get("/chat/{friend_username}")
async def fetch_chat(friend_username: str, current_user=Depends(get_current_user)):
    your_msgs = next((f.get("messages", []) for f in current_user.get("friends", []) if f["name"] == friend_username), [])
    # mark received unread -> read
    await db.users.update_one(
        {"email": current_user["email"], "friends.name": friend_username},
        {"$set": {"friends.$[f].messages.$[m].status": "read"}},
        array_filters=[{"f.name": friend_username}, {"m.status": "unread", "m.type": "received"}]
    )
    return {"messages": your_msgs}

from datetime import datetime, timezone



import asyncio

@app.post("/chat/{friend_username}/send")
async def send_chat_message(friend_username: str, data: MessageInput, current_user=Depends(get_current_user)):
    timestamp = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    image_flag = "Yes" if data.image else "No"
    text_payload = data.image if data.image else data.text

    sender_update = db.users.update_one(
        {"email": current_user["email"], "friends.name": friend_username},
        {"$push": {"friends.$.messages": {
            "text": text_payload, "image": image_flag, "time": timestamp, "type": "sent", "status": "read"
        }}}
    )

    receiver_update = db.users.update_one(
        {"username": friend_username, "friends.name": current_user["username"]},
        {"$push": {"friends.$.messages": {
            "text": text_payload, "image": image_flag, "time": timestamp, "type": "received", "status": "unread"
        }}}
    )

    realtime_msg = emit_to_user(friend_username, "message:new", {
        "from": current_user["username"],
        "to": friend_username,
        "message": {
            "text": text_payload,
            "image": (image_flag == "Yes"),
            "time": timestamp
        }
    })

    # fetch unseen count asynchronously
    async def update_unseen():
        rec_doc = await db.users.find_one({"username": friend_username})
        unseen = 0
        if rec_doc:
            for f in rec_doc.get("friends", []):
                if f.get("name") == current_user["username"]:
                    unseen = sum(1 for m in f.get("messages", []) if m.get("type") == "received" and m.get("status") == "unread")
                    break
        await emit_to_user(friend_username, "chat:unseen_update", {"friendUsername": current_user["username"], "unseenCount": unseen})

    # Run DB updates and realtime messages concurrently
    await asyncio.gather(sender_update, receiver_update, realtime_msg, update_unseen())

    return {"message": "sent"}


@app.post("/chat/mark_read")
async def mark_messages_read(data: dict, current_user=Depends(get_current_user)):
    friend_username = data.get("username")
    if not friend_username:
        raise HTTPException(status_code=400, detail="username required")

    user_doc = await db.users.find_one({"email": current_user["email"]})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")

    updated = False
    for friend in user_doc.get("friends", []):
        if friend.get("name") == friend_username:
            for msg in friend.get("messages", []):
                if msg.get("type") == "received" and msg.get("status") == "unread":
                    msg["status"] = "read"
                    updated = True
            break

    if updated:
        await db.users.replace_one({"_id": user_doc["_id"]}, user_doc)

    # also emit unseen reset to the caller
    await emit_to_user(current_user["username"], "chat:unseen_update", {"friendUsername": friend_username, "unseenCount": 0})
    return {"message": "Messages marked as read"}

# ----------------------------
# Root
# ----------------------------
@app.get("/")
async def root():
    return {"message": "FastAPI Chat Backend with Socket.IO"}

# ----------------------------
# Run
# ----------------------------
if __name__ == "__main__":
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True)
