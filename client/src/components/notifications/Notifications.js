import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const socket = io("http://localhost:8000", {
  auth: { token: localStorage.getItem("token") }
});

const Notifications = () => {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    const fetchRequests = async () => {
      const token = localStorage.getItem('token');
      try {
        const res = await axios.get('http://localhost:8000/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setRequests(res.data.requests || []);
      } catch (err) {
        console.error(err);
      }
    };
    fetchRequests();

    socket.on("new_friend_request", (username) => {
      setRequests(prev => [...prev, username]);
    });

    return () => socket.off("new_friend_request");
  }, []);

  const handleAccept = async (username) => {
    const token = localStorage.getItem('token');
    await axios.post('http://localhost:8000/requests/accept', { requesterUsername: username }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setRequests(requests.filter(r => r !== username));
  };

  const handleReject = async (username) => {
    const token = localStorage.getItem('token');
    await axios.post('http://localhost:8000/requests/reject', { requesterUsername: username }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setRequests(requests.filter(r => r !== username));
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Friend Requests</h2>
      {requests.length === 0 ? <p>No new requests</p> : (
        requests.map((username, i) => (
          <div key={i} className="flex justify-between items-center mb-2 border-b pb-2">
            <span>{username}</span>
            <div className="space-x-2">
              <button onClick={() => handleAccept(username)} className="bg-green-500 text-white px-2 py-1 rounded">Accept</button>
              <button onClick={() => handleReject(username)} className="bg-red-500 text-white px-2 py-1 rounded">Reject</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default Notifications;
