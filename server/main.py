from fastapi import FastAPI, WebSocketDisconnect, Depends, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
import socketio
import base64
import os

# Socket.IO
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
fastapi_app = socketio.ASGIApp(sio, other_asgi_app=app)

# MongoDB
client = AsyncIOMotorClient("mongodb+srv://nithinkodam69:nithin1k%40%24@cluster0.pamoj.mongodb.net/?retryWrites=true&w=majority")
db = client.chatting_db

# JWT & Password
SECRET_KEY = "my_chatting_gone"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="signin")

# Active socket connections
user_sockets = {}

# Schemas
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
    image: str | None = None

class MarkReadRequest(BaseModel):
    username: str

# Utils
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(404, detail="User not found")
    return user

@app.get("/me")
async def me(user=Depends(get_current_user)):
    return {
        "username": user["username"],
        "email": user["email"],
        "requests": user["requests"],
        "friends": user["friends"],
        "profile": user["profile"]
    }

@app.post("/signup")
async def signup(user: UserCreate):
    if await db.users.find_one({"email": user.email}) or await db.users.find_one({"username": user.username}):
        raise HTTPException(400, detail="Email or Username already exists")
    hashed_pw = get_password_hash(user.password)
    await db.users.insert_one({
        "username": user.username,
        "email": user.email,
        "password": hashed_pw,
        "requests": [],
        "friends": [],
        "profile": ""
    })
    return {"message": "User created successfully"}

@app.post("/signin", response_model=Token)
async def login(user: UserLogin):
    db_user = await db.users.find_one({"email": user.email})
    if not db_user or not verify_password(user.password, db_user["password"]):
        raise HTTPException(401, detail="Invalid credentials")
    token = create_access_token({"sub": db_user["email"]})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/{username}/chats")
async def get_chats(username: str, user=Depends(get_current_user)):
    if username != user["username"]:
        raise HTTPException(403, "Unauthorized")
    chats = []
    for friend in user.get("friends", []):
        messages = friend["messages"]
        unseen = sum(1 for m in messages if m["type"] == "received" and m["status"] == "unread")
        chats.append({
            "friendUsername": friend["name"],
            "unseenCount": unseen
        })
    return chats

@app.get("/chat/{friend_username}")
async def fetch_chat(friend_username: str, user=Depends(get_current_user)):
    friend = await db.users.find_one({"username": friend_username})
    if not friend:
        raise HTTPException(404, "Friend not found")
    your_msgs = next(f["messages"] for f in user["friends"] if f["name"] == friend_username)
    await db.users.update_one(
        {"email": user["email"], "friends.name": friend_username},
        {"$set": { "friends.$.messages.$[m].status": "read" }},
        array_filters=[{"m.status": "unread"}]
    )
    return {"messages": your_msgs}

@app.post("/chat/{friend_username}/send")
async def send_message(friend_username: str, data: dict, user=Depends(get_current_user)):
    text = data["text"]
    timestamp = datetime.utcnow()
    await db.users.update_one(
        {"email": user["email"], "friends.name": friend_username},
        {"$push": {"friends.$.messages": {
            "text": text, "image": "No", "time": timestamp, "type": "sent", "status": "read"
        }}}
    )
    await db.users.update_one(
        {"username": friend_username, "friends.name": user["username"]},
        {"$push": {"friends.$.messages": {
            "text": text, "image": "No", "time": timestamp, "type": "received", "status": "unread"
        }}}
    )
    # Emit real-time message to recipient
    if friend_username in user_sockets:
        await sio.emit("message", {
            "from": user["username"],
            "to": friend_username,
            "text": text,
            "image": "No",
            "timestamp": str(timestamp)
        }, to=user_sockets[friend_username])
    return {"message": "sent"}

@app.post("/chat/{friend_username}/sendimage")
async def send_image_message(friend_username: str, data: dict, user=Depends(get_current_user)):
    text = data["text"]
    timestamp = datetime.utcnow()
    await db.users.update_one(
        {"email": user["email"], "friends.name": friend_username},
        {"$push": {"friends.$.messages": {
            "text": text, "image": "Yes", "time": timestamp, "type": "sent", "status": "read"
        }}}
    )
    await db.users.update_one(
        {"username": friend_username, "friends.name": user["username"]},
        {"$push": {"friends.$.messages": {
            "text": text, "image": "Yes", "time": timestamp, "type": "received", "status": "unread"
        }}}
    )
    if friend_username in user_sockets:
        await sio.emit("message", {
            "from": user["username"],
            "to": friend_username,
            "text": text,
            "image": "Yes",
            "timestamp": str(timestamp)
        }, to=user_sockets[friend_username])
    return {"message": "sent"}


@app.get("/notifications/count")
async def notif_count(user=Depends(get_current_user)):
    count = len(user.get("requests", []))
    return {"count": count}


@app.get("/users/search")
async def search_users(q: str, user=Depends(get_current_user)):
    all_users = await db.users.find({"username": {"$regex": q, "$options": "i"}}).to_list(20)
    return [{"username": u["username"], "email": u["email"], "profile": u["profile"]} for u in all_users if u["email"] != user["email"]]


@app.post("/requests")
async def send_request(data: dict, user=Depends(get_current_user)):
    toUsername = data.get("toUsername")
    if not await db.users.find_one({"username": toUsername}):
        raise HTTPException(404, "User not found")
    await db.users.update_one(
        {"username": toUsername},
        {"$addToSet": {"requests": user["username"]}}
    )
    if toUsername in user_sockets:
        await sio.emit("friend_request", {"from": user["username"]}, to=user_sockets[toUsername])
    return {"message": "Request sent"}


@app.post("/requests/accept")
async def accept_request(data: dict, user=Depends(get_current_user)):
    requester_username = data.get("requesterUsername")
    requester = await db.users.find_one({"username": requester_username})
    if not requester:
        raise HTTPException(404, "Requester not found")

    # Remove request
    await db.users.update_one(
        {"username": user["username"]},
        {"$pull": {"requests": requester_username}}
    )
    # Remove request
    await db.users.update_one(
        {"username": requester_username},
        {"$pull": {"requests": user["username"] }}
    )

    # Add each other as friends
    await db.users.update_one(
        {"username": user["username"]},
        {"$addToSet": {"friends": {"name": requester["username"], "messages": []}}}
    )
    await db.users.update_one(
        {"username": requester_username},
        {"$addToSet": {"friends": {"name": user["username"], "messages": []}}}
    )
    return {"message": "Friend added"}


@app.post("/requests/reject")
async def reject_request(data: dict, user=Depends(get_current_user)):
    requester_username = data.get("requesterUsername")
    await db.users.update_one(
        {"username": user["username"]},
        {"$pull": {"requests": requester_username}}
    )
    return {"message": "Request rejected"}



@app.post("/profile/upload")
async def upload_profile_image(file: UploadFile = File(...), user=Depends(get_current_user)):
    content = await file.read()
    encoded = base64.b64encode(content).decode()
    await db.users.update_one(
        {"email": user["email"]},
        {"$set": {"profile": encoded}}
    )
    return {"message": "Profile image uploaded"}



@app.get("/friend/{friend_username}/profile")
async def get_friend_profile(friend_username: str, user=Depends(get_current_user)):
    # Get the current user from the DB
    current_user = db.users.find_one({"email": user["email"]})
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")

    # Look up the friend in the user's friend list
    friend_entry = next((f for f in current_user.get("friends", []) if f["name"] == friend_username), None)
    if not friend_entry:
        raise HTTPException(status_code=404, detail="Friend not found in your friend list")

    # Also get full profile of the friend if needed
    friend_user = db.users.find_one({ "username": friend_username })

    return {
        "name": friend_entry["name"],
        "profile": friend_user.get("profile", "") if friend_user else "",
        "messages": friend_entry.get("messages", [])
    }
    
    

@app.get("/profile/{friend_username}")
async def get_friend_profile(friend_username: str, user=Depends(get_current_user)):
    # Fetch the current user
    current_user = db.users.find_one({"email": user["email"]})
    if not current_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Look for the friend in the current user's friend list
    friend_entry = next((f for f in current_user.get("friends", []) if f["name"] == friend_username), None)
    if not friend_entry:
        raise HTTPException(status_code=404, detail="Friend not in your list")

    # Fetch friend's full profile
    friend_user = db.users.find_one({ "username": friend_username })
    if not friend_user:
        raise HTTPException(status_code=404, detail="Friend profile not found")

    return {
        "name": friend_entry["name"],
        "profile": friend_user.get("profile", ""),  # base64-encoded string
        "messages": friend_entry.get("messages", [])
    }
    
    
@app.get("/him")
async def get_him_profile(name: str, user=Depends(get_current_user)):
    friend = await db.users.find_one({ "username": name })
    if not friend:
        raise HTTPException(status_code=404, detail="Friend not found")
    return {
        "profile": friend.get("profile", "")
    }

from bson import ObjectId

from fastapi import Request

@app.post("/chat/mark_read")
async def mark_messages_read(data: dict, request: Request, current_user=Depends(get_current_user)):
    try:
        friend_username = data.get("username")
        # print("Looking for friend:", friend_username)
        updated = False

        for friend in current_user["friends"]:
            if friend["name"] == friend_username:
                # print(friend["messages"])
                for msg in friend["messages"]:
                    if msg["type"] == "received" and msg["status"] == "unread":
                        msg["status"] = "read"
                        updated = True
                break

        if updated:
            await db.users.replace_one({"_id": current_user["_id"]}, current_user)

        return {"message": "Messages marked as read"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}



# ==== Socket.IO Events ====
@sio.event
async def connect(sid, environ, auth):
    token = auth.get("token") if auth else None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        user = await db.users.find_one({"email": email})
        if user:
            user_sockets[user["username"]] = sid
            print(f"User {user['username']} connected with sid: {sid}")
    except Exception as e:
        print("Connection rejected:", e)
        return False  # Reject connection

@sio.event
def disconnect(sid):
    to_remove = [u for u, s in user_sockets.items() if s == sid]
    for u in to_remove:
        del user_sockets[u]
        print(f"User {u} disconnected.")