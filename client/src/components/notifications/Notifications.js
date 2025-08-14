import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getSocket } from '../socket';

const Notifications = () => {
  const [requests, setRequests] = useState([]);

  const loadRequests = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await axios.get('http://localhost:8000/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRequests(res.data.requests || []);
    } catch (err) {
      console.error('Failed to fetch requests', err);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const socket = getSocket(token);

    const onRequestNew = ({ from }) => {
      setRequests(prev => (prev.includes(from) ? prev : [from, ...prev]));
    };

    socket.on('request:new', onRequestNew);

    return () => {
      socket.off('request:new', onRequestNew);
    };
  }, []);

  const handleAccept = async (username) => {
    const token = localStorage.getItem('token');
    try {
      await axios.post('http://localhost:8000/requests/accept', { requesterUsername: username }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRequests(prev => prev.filter(r => r !== username));
    } catch (err) {
      console.error('Accept failed', err);
      alert('Accept failed');
    }
  };

  const handleReject = async (username) => {
    const token = localStorage.getItem('token');
    try {
      await axios.post('http://localhost:8000/requests/reject', { requesterUsername: username }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRequests(prev => prev.filter(r => r !== username));
    } catch (err) {
      console.error('Reject failed', err);
      alert('Reject failed');
    }
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
