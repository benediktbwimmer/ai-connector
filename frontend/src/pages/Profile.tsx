import { useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { apiGet, apiPost } from '../api';
import type { SettingsResponse } from '../api';

function ProfilePage(): JSX.Element {
  const [profile, setProfile] = useState<SettingsResponse | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<SettingsResponse>('/profile')
      .then((data) => {
        setProfile(data);
        setName(data.profile_name ?? '');
        setEmail(data.profile_email ?? '');
      })
      .catch((err) => {
        console.error('Failed to load profile', err);
        setError('Unable to load profile.');
      });
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const response = await apiPost<SettingsResponse>('/profile', {
        name,
        email,
      });
      setProfile(response);
      setStatus('Profile updated');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="card">
        <h2 className="section-title">Profile</h2>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="section-title">Profile</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">Display name</label>
          <input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Operator"
          />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      <div style={{ marginTop: '1rem', color: '#94a3b8' }}>
        <p>OpenAI API key configured: {profile.openai_api_key_set ? 'Yes' : 'No'}</p>
        <p>API base: {profile.openai_base_url}</p>
      </div>
      {status && <div className="success">{status}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default ProfilePage;
