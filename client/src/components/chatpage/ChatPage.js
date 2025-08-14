import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { FiSend, FiImage } from 'react-icons/fi';
import defaultAvatar from '../chatpage/default_avatar.png';
import { getSocket } from '../socket';

const ChatPage = () => {
  const { username: me, friend } = useParams();
  const friend_username = friend;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [friendData, setFriendData] = useState('');
  const scrollRef = useRef(null);
  const token = localStorage.getItem('token');

  // Helper: parse ISO robustly and format local time (HH:MM AM/PM or 24h per browser locale)
  const formatTime = (iso) => {
    if (!iso) return '';
    let s = String(iso);
    // If string looks like "YYYY-MM-DDTHH:MM:SS" (no Z / offset) append 'Z'
    // Regex matches "2025-08-14T05:05:00" optionally with fractional seconds
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
      s = s + 'Z';
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      // final fallback: show original string (or empty)
      return iso;
    }
    // Format to show hours:minutes (and seconds if you want)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Parse date for sorting - returns timestamp ms, fallback 0
  const parseTimeMs = (iso) => {
    if (!iso) return 0;
    let s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
      s = s + 'Z';
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  };

  // Initial thread
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get('http://localhost:8000/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const user = res.data;
        const friendObj = user.friends?.find(f => f.name === friend_username);
        if (friendObj) setMsgs(friendObj.messages || []);
      } catch (err) {
        console.error('Error fetching user data:', err);
      }
    };
    fetchData();
  }, [friend_username, token]);

  // Friend header info
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
  }, [friend_username, token]);

  // Mark as read, socket listeners
  useEffect(() => {
    const markAsReadREST = async () => {
      try {
        await axios.post(
          'http://localhost:8000/chat/mark_read',
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
    markAsReadREST();

    const socket = getSocket(token);
    if (!socket) return;

    // Inform server this chat is open (server marks read & emits unseen reset)
    socket.emit('chat_read', { me, friend: friend_username });

    // Listen incoming messages for this chat
    const onNewMessage = (payload) => {
      if (payload.from === friend_username && payload.to === me) {
        const m = payload.message;
        setMsgs(prev => [
          ...prev,
          {
            text: m.text,
            image: m.image ? 'Yes' : 'No',
            time: m.time || new Date().toISOString(),
            type: 'received',
            status: 'read'
          }
        ]);
        // confirm read immediately if this chat is focused
        socket.emit('chat_read', { me, friend: friend_username });
      }
    };

    // optional: friend updated profile (refetch)
    const onProfileUpdated = ({ username }) => {
      if (username === friend_username) {
        axios.get(`http://localhost:8000/him?name=${friend_username}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).then(r => setFriendData(r.data)).catch(() => {});
      }
    };

    socket.on('message:new', onNewMessage);
    socket.on('profile:updated', onProfileUpdated);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('profile:updated', onProfileUpdated);
    };
  }, [friend_username, token, me]);

  // Auto-scroll on messages change
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  // Send text
  const send = async () => {
    if (!input.trim()) return;

    const newMsg = {
      text: input,
      image: 'No',
      time: new Date().toISOString(), // includes 'Z'
      type: 'sent',
      status: 'read'
    };

    try {
      await axios.post(`http://localhost:8000/chat/${friend_username}/send`, { text: input }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMsgs(prev => [...prev, newMsg]);
      setInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // Send image (base64)
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Image = reader.result;
      const newMsg = {
        text: base64Image,
        image: 'Yes',
        time: new Date().toISOString(),
        type: 'sent',
        status: 'read'
      };

      try {
        // backend accepts { text, image } (we keep same contract)
        await axios.post(`http://localhost:8000/chat/${friend_username}/send`, { text: '', image: base64Image }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setMsgs(prev => [...prev, newMsg]);
      } catch (err) {
        console.error('Failed to send image:', err);
      }
    };
    reader.readAsDataURL(file);
  };

  // Render: sort reliably using parseTimeMs
  const sortedMsgs = [...msgs].sort((a, b) => parseTimeMs(a.time) - parseTimeMs(b.time));

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
        {sortedMsgs.map((m, i) => (
          <div key={i} className={`flex ${m.type === 'sent' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs p-2 rounded shadow ${m.type === 'sent' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black'}`}>
              {m.image === 'Yes' ? (
                <img src={m.text} alt="sent" className="rounded mb-1 max-w-full" />
              ) : (
                <div>{m.text}</div>
              )}
              <small className="text-xs block text-right mt-1">
                {formatTime(m.time)}
              </small>
            </div>
          </div>
        ))}
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
