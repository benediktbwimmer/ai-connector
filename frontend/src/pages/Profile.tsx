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

  return (
    <div className="flex justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Profile</p>
          <h1 className="text-3xl font-semibold text-slate-100">Your operator identity</h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Keep your details up to date so responses can be personalized with your name and contact information.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-6 shadow-glow">
          {!profile ? (
            <div className="text-sm text-slate-400">Loading…</div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="name">
                  Display name
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Operator"
                  className="w-full rounded-xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-indigo-500 px-6 py-2 text-sm font-medium text-slate-950 transition hover:from-sky-300 hover:via-sky-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <span className="text-xs text-slate-500">
                  OpenAI API key configured: {profile.openai_api_key_set ? 'Yes' : 'No'}
                </span>
              </div>
              <p className="text-xs text-slate-500">API base: {profile.openai_base_url}</p>
            </form>
          )}

          {status && <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div>}
          {error && <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        </div>
      </div>
    </div>
  );
}

export default ProfilePage;
