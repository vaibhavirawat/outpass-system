import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { connectSocket } from '../services/socketService';
import { useApp } from '../context/AuthContext';

export default function VideoCall() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, toast } = useApp();
  const localRef = useRef(); const remoteRef = useRef();
  const stream = useRef(); const [call, setCall] = useState(null);
  const [status, setStatus] = useState('Starting camera…');
  const [muted, setMuted] = useState(false); const [camOff, setCamOff] = useState(false);
  const [peer, setPeer] = useState('');

  useEffect(() => {
    let pc, socket, closed = false; const pending = [];
    const cleanup = () => { closed = true; stream.current?.getTracks().forEach((t) => t.stop()); pc?.close(); socket?.disconnect(); };

    (async () => {
      try {
        const { call: c, iceServers } = await api(`/video-calls/${id}/join`, { method: 'POST' });
        if (closed) return;
        setCall(c);
        stream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (closed) return cleanup();
        localRef.current.srcObject = stream.current;

        pc = new RTCPeerConnection({ iceServers });
        stream.current.getTracks().forEach((t) => pc.addTrack(t, stream.current));
        pc.ontrack = (e) => { remoteRef.current.srcObject = e.streams[0]; };
        pc.onconnectionstatechange = () => {
          const s = pc.connectionState;
          if (s === 'connected') setStatus('Connected');
          if (s === 'failed') setStatus('Connection failed — a TURN server may be required on this network.');
        };

        socket = connectSocket();
        const signal = (data) => socket.emit('call:signal', { callId: id, data });
        pc.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate });

        socket.on('call:peer-joined', async ({ name }) => {   // we were here first → we make the offer
          setPeer(name); setStatus('Connecting…');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signal({ sdp: pc.localDescription });
        });
        socket.on('call:signal', async ({ data }) => {
          try {
            if (data.sdp) {
              await pc.setRemoteDescription(data.sdp);
              while (pending.length) await pc.addIceCandidate(pending.shift());
              if (data.sdp.type === 'offer') {
                setStatus('Connecting…');
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                signal({ sdp: pc.localDescription });
              }
            } else if (data.candidate) {
              if (pc.remoteDescription) await pc.addIceCandidate(data.candidate); else pending.push(data.candidate);
            }
          } catch (err) { console.error(err); }
        });
        socket.on('call:peer-left', () => setStatus('The other participant left.'));
        socket.on('call:ended', ({ reason }) => {
          toast(reason === 'declined' ? 'The parent declined the call.' : 'Call ended.');
          cleanup(); nav('/');
        });
        socket.emit('call:join', { callId: id });
        setStatus(user.role === 'warden' ? 'Waiting for the parent to join…' : 'Waiting for the warden…');
      } catch (e) {
        toast(e.name === 'NotAllowedError' ? 'Camera/microphone permission denied.' : e.message, 'error');
        cleanup(); nav('/');
      }
    })();
    return cleanup;
  }, [id]); // eslint-disable-line

  const toggle = (kind) => {
    const tracks = kind === 'audio' ? stream.current?.getAudioTracks() : stream.current?.getVideoTracks();
    const next = !(kind === 'audio' ? muted : camOff);
    tracks?.forEach((t) => { t.enabled = !next; });
    kind === 'audio' ? setMuted(next) : setCamOff(next);
  };
  const end = async () => { try { await api(`/video-calls/${id}/end`, { method: 'POST' }); } catch {} nav('/'); };

  const me = user.full_name;
  const them = peer || (call ? (user.id === call.warden_id ? call.parent_name : call.warden_name) : '');
  return (
    <>
      <h2>Video call{call ? ` — ${call.student_name}'s outpass` : ''}</h2>
      <div className="call-status">{status}</div>
      <div className="videos">
        <div className="vbox"><video ref={remoteRef} autoPlay playsInline /><span>{them || 'Participant'}</span></div>
        <div className="vbox small"><video ref={localRef} autoPlay playsInline muted /><span>{me} (you)</span></div>
      </div>
      <div className="actions">
        <button className="btn" onClick={() => toggle('audio')}>{muted ? '🔇 Unmute' : '🎤 Mute'}</button>
        <button className="btn" onClick={() => toggle('video')}>{camOff ? '📷 Camera on' : '🚫 Camera off'}</button>
        <button className="btn danger" onClick={end}>End call</button>
      </div>
    </>
  );
}
