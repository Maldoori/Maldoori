import {resourcesFrom,tasksFrom,backupResults} from './acronis-inventory.js';
export class AcronisClient {
  constructor({url,clientId,secret}, fetcher=fetch) {
    this.configured=Boolean(url&&clientId&&secret);this.fetcher=fetcher;
    if(!this.configured)return;
    this.url=new URL(url);
    if(this.url.protocol!=='https:'||!this.url.hostname.endsWith('.acronis.com')||this.url.port||this.url.username||this.url.password||this.url.search||this.url.hash||this.url.pathname!=='/')throw new Error('ACRONIS_URL must be an HTTPS Acronis data center origin.');
    this.clientId=clientId;this.secret=secret;this.token=null;this.expires=0;
  }
  async authenticate(){
    if(!this.configured)throw new Error('Acronis credentials are not configured.');
    if(this.token&&Date.now()<this.expires)return;
    if(this.authenticating)return this.authenticating;
    this.authenticating=(async()=>{
      let response;
      try{response=await this.fetcher(new URL('/api/2/idp/token',this.url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(this.clientId+':'+this.secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});}catch{throw new Error('Cannot connect securely to Acronis. Check the data center address and network.');}
      if(!response.ok)throw new Error(response.status===401||response.status===403?'Acronis authentication failed. Check the replacement API client and permissions.':'Acronis authentication is unavailable. Try again later.');
      let value;try{value=await response.json();}catch{throw new Error('Unexpected Acronis authentication response.');}
      if(typeof value.access_token!=='string'||!value.access_token||!Number.isFinite(value.expires_in)||value.expires_in<=0)throw new Error('Unexpected Acronis authentication response.');
      this.token=value.access_token;this.expires=Date.now()+Math.max(0,value.expires_in-60)*1000;
    })().finally(()=>this.authenticating=null);
    return this.authenticating;
  }
  async read(path,retry=true){
    await this.authenticate();
    const url=new URL(path,this.url);
    if(url.origin!==this.url.origin||!url.pathname.startsWith('/api/'))throw new Error('Acronis returned an unsafe API destination.');
    let response;
    try{response=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+this.token}});}
    catch{throw new Error('Cannot read Acronis inventory securely. Try again later.');}
    if(response.status===401&&retry){this.token=null;this.expires=0;return this.read(path,false);}
    if(!response.ok)throw new Error('Acronis inventory request failed (HTTP '+response.status+'). Check API permissions.');
    let value;try{value=await response.json();}catch{throw new Error('Unexpected Acronis inventory response.');}
    return value;
  }
  async collection(path){
    const items=[],visited=new Set();let complete=true;
    for(let page=0;path&&page<20;page++){
      const normalized=new URL(path,this.url).href;
      if(visited.has(normalized))throw new Error('Acronis repeated an inventory page.');visited.add(normalized);
      const value=await this.read(path);
      if(!Array.isArray(value.items))throw new Error('Unexpected Acronis inventory list.');
      items.push(...value.items);if(items.length>10000)throw new Error('Acronis inventory exceeds this integration limit.');
      const next=value._links?.find?.(link=>link.rel==='next')?.href;
      if(!next&&Number.isFinite(value.paging?.cursors?.total)&&value.paging.cursors.total>items.length)complete=false;
      path=typeof next==='string'?next:null;
    }
    if(path)complete=false;return {items,complete};
  }
  async inventory(){
    const [resources,tasks]=await Promise.all([this.collection('/api/resource_management/v4/resources'),this.collection('/api/task_manager/v2/tasks')]);
    return {backupResults:backupResults(resources.items,tasks.items),resources:resourcesFrom(resources.items),tasks:tasksFrom(tasks.items),complete:resources.complete&&tasks.complete,checkedAt:new Date().toISOString(),consoleUrl:this.url.href};
  }
  async testConnection(){this.expires=0;await this.authenticate();return {configured:true,authenticated:true,checkedAt:new Date().toISOString(),consoleUrl:this.url.href,backupStatusVerified:false};}
}
