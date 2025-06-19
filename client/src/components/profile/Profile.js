// Profile.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const Profile = () => {
  const [user, setUser] = useState(null);
  const [uploading, setUploading] = useState(false);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    const res = await axios.get('http://localhost:8000/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    setUser(res.data);
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);

    try {
      const res = await axios.post('http://localhost:8000/profile/upload', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Update profile image directly without reloading
      setUser(prev => ({ ...prev, profile: res.data.profile }));

      // Emit profile update
      if (window.socket) {
        window.socket.emit("profile_updated", {
          username: user.username
        });
      }
    } catch (err) {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!user) return <div>Loading...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center space-x-4 mb-4">
        {user.profile ? (
          <img src={`data:image/*;base64,${user.profile}`} alt="Profile" className="w-24 h-24 rounded-full" />
        ) : (
          <div className="w-24 h-24 bg-gray-300 rounded-full flex items-center justify-center">No Profile</div>
        )}
        <div>
          <p className="text-xl font-semibold">Friends</p>
          <p>{user.friends?.length || 0}</p>
        </div>
      </div>
      <label className="block text-blue-600 cursor-pointer mt-4">
        <input type="file" accept="image/*" hidden onChange={handleUpload} />
        {uploading ? 'Uploading...' : 'Add image'}
      </label>
    </div>
  );
};

export default Profile;
