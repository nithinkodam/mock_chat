import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { FiSend, FiImage } from 'react-icons/fi';
import defaultAvatar from '../chatpage/default_avatar.png';
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  transports: ['websocket'],
  autoConnect: false
});

const ChatPage = () => {
  const { username: me, friend } = useParams();
  const friend_username = friend;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [friendData, setFriendData] = useState('');
  const scrollRef = useRef(null);
  const token = localStorage.getItem('token');

  // Fetch messages from backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get('http://localhost:8000/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const user = res.data;
        const friendObj = user.friends.find(f => f.name === friend_username);
        if (friendObj) {
          setMsgs(friendObj.messages || []);
        }
      } catch (err) {
        console.error('Error fetching user data:', err);
      }
    };
    fetchData();
  }, [friend_username]);

  // Fetch friend's data
  useEffect(() => {
    const fetchFriend = async () => {
      try {
        const res = await axios.get(`http://localhost:8000/him?name=${friend_username}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setFriendData(res.data);
      } catch (err) {
        console.error('Error fetching friend info:', err);
      }
    };
    fetchFriend();
  }, [friend_username]);

  // Mark messages as read
  useEffect(() => {
    const markAsRead = async () => {
      try {
        await axios.post("http://localhost:8000/chat/mark_read",
          { username: friend_username },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (err) {
        console.error('Failed to mark messages as read:', err);
      }
    };
    markAsRead();
  }, [friend_username]);

  // Auto scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  // Connect socket on mount and handle real-time messages
  useEffect(() => {
    if (!token) return;

    // socket.auth = { token };
    // socket.connect();

    socket.emit('join', { room: getRoomId(me, friend_username) });

    socket.on('receive_message', (msg) => {
      setMsgs(prev => [...prev, msg]);
    });

    return () => {
      socket.off('receive_message');
      // socket.disconnect();
    };
  }, [me, friend_username]);

  // Util to compute room id (e.g., alphabetical order)
  const getRoomId = (u1, u2) => {
    return [u1, u2].sort().join('_');
  };

  // Send text message
  const send = () => {
    if (!input.trim()) return;

    const newMsg = {
      text: input,
      image: "No",
      time: new Date().toISOString(),
      type: 'sent',
      status: 'read'
    };

    // Emit via socket
    socket.emit('send_message', {
      to: friend_username,
      message: newMsg
    });

    // Persist to backend
    axios.post(`http://localhost:8000/chat/${friend_username}/send`, { text: input }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    setMsgs(prev => [...prev, newMsg]);
    setInput('');
  };

  // Send image message
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Image = reader.result;
      const newMsg = {
        text: base64Image,
        image: "Yes",
        time: new Date().toISOString(),
        type: 'sent',
        status: 'read'
      };

      socket.emit('send_message', {
        to: friend_username,
        message: newMsg
      });

      axios.post(`http://localhost:8000/chat/${friend_username}/sendimage`, { text: base64Image }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setMsgs(prev => [...prev, newMsg]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="p-4 bg-gray-100 shadow flex items-center space-x-4">
        <img
          src={friendData?.profile ? `data:image/jpeg;base64,${friendData.profile}` : defaultAvatar}
          alt="profile"
          className="w-10 h-10 rounded-full object-cover"
        />
        <h2 className="text-lg font-semibold">{friendData?.name || friend_username}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {msgs
          .sort((a, b) => new Date(a.time) - new Date(b.time))
          .map((m, i) => (
            <div key={i} className={`flex ${m.type === 'sent' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs p-2 rounded shadow ${m.type === 'sent' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black'}`}>
                {m.image === 'Yes' ? (
                  <img src={m.text} alt="sent" className="rounded mb-1 max-w-full" />
                ) : (
                  <div>{m.text}</div>
                )}
                <small className="text-xs block text-right mt-1">
                  {new Date(m.time).toLocaleTimeString()}
                </small>
              </div>
            </div>
          ))
        }
        <div ref={scrollRef} />
      </div>

      <footer className="p-2 flex items-center border-t gap-2">
        <label className="cursor-pointer">
          <FiImage size={24} className="text-gray-600" />
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
        <input
          className="flex-1 border rounded px-2 py-1"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Type a message"
        />
        <button onClick={send} className="bg-indigo-600 text-white p-2 rounded-full">
          <FiSend size={20} />
        </button>
      </footer>
    </div>
  );
};

export default ChatPage;
