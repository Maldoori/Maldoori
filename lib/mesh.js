import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export class MeshClient {
  constructor({ url, username, password }) {
    this.url = new URL(url);
    if (this.url.protocol !== 'https:' || this.url.username || this.url.password || this.url.search || this.url.hash) throw new Error('MESH_URL must be an HTTPS base URL without credentials or query parameters.');
    if (!this.url.pathname.endsWith('/')) this.url.pathname += '/';
    if (!username || !password) throw new Error('MeshCentral integration credentials are missing.');
    this.auth = Buffer.from(username).toString('base64') + ',' + Buffer.from(password).toString('base64');
  }
  request(action, fields = {}, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL('control.ashx', this.url); url.protocol = 'wss:';
      const responseid = randomUUID();
      const socket = new WebSocket(url, { headers: { 'x-meshauth': this.auth }, rejectUnauthorized: true, handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 });
      let finished = false;
      const finish = (error, data) => {
        if (finished) return;
        finished = true; clearTimeout(timer); socket.terminate();
        error ? reject(error) : resolve(data);
      };
      const timer = setTimeout(() => finish(new Error(options.telemetry ? 'MeshCentral telemetry timed out. Check the Windows agent and remote command access.' : options.output ? 'MeshCentral service request timed out. Do not retry a change until you refresh its status.' : 'MeshCentral request timed out.')), options.output ? 45000 : 15000);
      socket.on('open', () => socket.send(JSON.stringify({ ...fields, action, responseid, tag: responseid })));
      socket.on('message', raw => {
        let data; try { data = JSON.parse(raw); } catch { return; }
        if (data.action === 'close') return finish(new Error('MeshCentral authentication failed. Check the integration account or login token.'));
        // MeshCentral 1.1.59 returns tag rather than responseid for meshes.
        if (data.responseid !== responseid && data.tag !== responseid) return;
        if (options.output && data.action === 'msg' && data.type === 'runcommands') return finish(null, data);
        if (data.result && data.result !== 'OK' && data.result !== 'ok') return finish(new Error('MeshCentral rejected the operation. Check account permissions.'));
        if (options.output) return;
        finish(null, data);
      });
      socket.on('error', () => finish(new Error('Cannot connect securely to MeshCentral. Check its certificate, address, and integration credentials.')));
      socket.on('close', () => finish(new Error('MeshCentral closed the connection before responding.')));
    });
  }
  desktopUrl(nodeId) {
    const url = new URL(this.url);
    url.searchParams.set('viewmode', '11');
    // Use MeshCentral's own new-window device link format. `node` lets the
    // server initialize the selected device before opening its Desktop tab.
    url.searchParams.set('node', nodeId.split('/').at(-1));
    url.searchParams.set('maldooriConnect', '1');
    return url.href;
  }
  async invitation(meshId) {
    const result = await this.request('createInviteLink', { meshid: meshId, expire: 24, flags: 0 });
    if (!result.url) throw new Error('MeshCentral did not return an invitation. Check invitation support and permissions.');
    const url = new URL(result.url, this.url);
    if (url.origin !== this.url.origin || url.protocol !== 'https:') throw new Error('MeshCentral returned an unexpected invitation destination.');
    return url.href;
  }
}
