import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const socket = io("http://localhost:8000", {
  auth: { token: localStorage.getItem("token") }
});

const Chats = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [user, setUser] = useState({});
  const [chatList, setChatList] = useState([]);
  const [requestsCount, setRequestsCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchChatList = async () => {
    if (!token) return;
    try {
      const res = await axios.get('http://localhost:8000/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const currentUser = res.data;
      setUser(currentUser);

      const chatsRes = await axios.get(`http://localhost:8000/${currentUser.username}/chats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setChatList(chatsRes.data);

      const notifRes = await axios.get(`http://localhost:8000/notifications/count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRequestsCount(notifRes.data.count);
    } catch (err) {
      console.error("Error fetching data", err);
    }
  };

  useEffect(() => {
    fetchChatList();

    const handleFocus = () => fetchChatList();
    document.addEventListener("visibilitychange", handleFocus);

    socket.on("new_message", (data) => {
      if (data && data.sender) {
        setChatList(prevList => {
          const updatedList = [...prevList];
          const index = updatedList.findIndex(c => c.friendUsername === data.sender);
          if (index !== -1) {
            updatedList[index].unseenCount += 1;
          } else {
            updatedList.push({ friendUsername: data.sender, unseenCount: 1 });
          }
          return [...updatedList];
        });
      }
    });

    socket.on("new_friend_request", () => {
      setRequestsCount(prev => prev + 1);
    });

    return () => {
      document.removeEventListener("visibilitychange", handleFocus);
      socket.off("new_message");
      socket.off("new_friend_request");
    };
  }, [token]);

  const onNotifications = () => navigate(`/${user.username}/notifications`);
  const goSearch = () => navigate(`/${user.username}/search`);
  const goProfile = () => navigate(`/${user.username}/profile`);

  const openChat = (friendUsername) => {
    navigate(`/${user.username}/chat/${friendUsername}`);
  };

  const filteredChats = chatList.filter(c =>
    c.friendUsername.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="container flex flex-col h-screen">
      <header className="flex items-center justify-between p-4 bg-white shadow fixed top-0 left-0 right-0 z-10">
        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="border rounded px-3 py-2 w-full max-w-md"
        />
        <div className="relative ml-4">
          <button onClick={onNotifications} className="relative text-xl">
            🔔
            {requestsCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1">
                {requestsCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto mt-20 mb-16 px-4">
        {filteredChats.length === 0 && (
          <div className="text-center text-gray-400 mt-10">No chats found</div>
        )}
        {filteredChats.map(c => (
          <div
            key={c.friendUsername}
            className="flex justify-between items-center p-3 hover:bg-gray-100 rounded cursor-pointer"
            onClick={() => openChat(c.friendUsername)}
          >
            <div className="text-lg font-medium">{c.friendUsername}</div>
            {c.unseenCount > 0 && (
              <span className="bg-indigo-600 text-white rounded-full px-2 text-sm">
                {c.unseenCount}
              </span>
            )}
          </div>
        ))}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white shadow-inner flex justify-around p-3">
        <button onClick={() => navigate(`/${user.username}/chats`)} className="flex flex-col items-center">
          Chats
        </button>
        <button onClick={goSearch} className="flex flex-col items-center">
          Search
        </button>
        <button onClick={goProfile} className="flex flex-col items-center">
          Profile
        </button>
      </footer>
    </div>
  );
};

export default Chats;
