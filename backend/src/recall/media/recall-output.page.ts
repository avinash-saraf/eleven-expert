// Recall loads this page inside the bot and captures its audio output into Meet.
// Only PCM and playback control cross this socket; provider credentials stay server-side.
export const RECALL_OUTPUT_PATH = '/recall/output/';
export const RECALL_OUTPUT_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>AI Apprentice</title><style>
body{margin:0;background:#112035;color:#fff;font:32px system-ui;display:grid;place-items:center;height:100vh}
</style></head><body><div>AI Apprentice</div><script>
const audio = new AudioContext({ sampleRate: 24000 });
let socket, speechId, nextTime=0, active=0, ended=false, sources=new Set();
function send(type) { if(socket.readyState===1) socket.send(JSON.stringify({type,speechId})); }
function finished() { if(ended && active===0 && speechId){ send('playback_finished'); speechId=null; } }
function cancel() { for(const source of sources) source.stop(); sources.clear();active=0;speechId=null;nextTime=0;ended=false; }
function connect(){
  const url=new URL(location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
  socket=new WebSocket(url);socket.binaryType='arraybuffer';
  let chain=Promise.resolve();
  socket.onopen=async()=>{try{await audio.resume();if(audio.state!=='running')throw Error();send('ready');}catch{send('playback_error');}};
  socket.onmessage=event=>{chain=chain.then(async()=>{
    if(typeof event.data==='string'){
      const message=JSON.parse(event.data);
      if(message.type==='speech_start'){cancel();speechId=message.speechId;}
      if(message.type==='speech_end'){ended=true;finished();}
      if(message.type==='cancel')cancel();
      return;
    }
    if(!speechId || event.data.byteLength===0)return;
    await audio.resume();if(audio.state!=='running')throw Error();
    const view=new DataView(event.data), buffer=audio.createBuffer(1,view.byteLength/2,24000);
    const samples=buffer.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
    const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);
    if(active===0 && nextTime===0)send('playback_started');
    const start=Math.max(nextTime,audio.currentTime+0.025);nextTime=start+buffer.duration;active++;sources.add(source);
    source.onended=()=>{if(sources.delete(source))active--;finished();};source.start(start);
  }).catch(()=>{send('playback_error');cancel();});};
  socket.onclose=()=>{cancel();setTimeout(connect,1000);};
}
connect();
</script></body></html>`;
