import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../socket';

const Profile = () => {
  const [user, setUser] = useState(null);
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await axios.get('https://mock-chat-backend.onrender.com/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(res.data);
    } catch (err) {
      console.error('Failed to fetch user', err);
    }
  };

  useEffect(() => {
    fetchUser();
    const token = localStorage.getItem('token');
    const socket = getSocket(token);
    if (socket) {
      const onProfile = ({ username }) => {
        if (username === user?.username) {
          fetchUser();
        }
      };
      socket.on("profile:updated", onProfile);
      return () => socket.off("profile:updated", onProfile);
    }
  }, [user?.username]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);

    try {
      await axios.post('https://mock-chat-backend.onrender.com/profile/upload', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchUser();
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = () => {
    Swal.fire({
      title: 'Logged out!',
      text: 'You have been successfully logged out.',
      icon: 'success',
      timer: 1000,
      showConfirmButton: false
    }).then(() => {
      localStorage.removeItem('token');
      navigate('/');
    });
  };

  if (!user) return <div>Loading...</div>;

  return (
    <div className="p-6">
      {/* Profile + Logout Row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          {user.profile ? (
            <img
              src={`data:image/*;base64,${user.profile}`}
              alt="Profile"
              className="w-24 h-24 rounded-full"
            />
          ) : (
            <div className="w-24 h-24 bg-gray-300 rounded-full flex items-center justify-center">
              No Profile
            </div>
          )}
          <div>
            <p className="text-xl font-semibold">Friends</p>
            <p>{user.friends?.length || 0}</p>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg shadow-md transition duration-200"
        >
          Logout
        </button>
      </div>

      {/* Upload Image */}
      <label className="block text-blue-600 cursor-pointer mt-4">
        <input type="file" accept="image/*" hidden onChange={handleUpload} />
        {uploading ? 'Uploading...' : 'Add image'}
      </label>
    </div>
  );
};

export default Profile;
