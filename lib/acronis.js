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
  async testConnection(){this.expires=0;await this.authenticate();return {configured:true,authenticated:true,checkedAt:new Date().toISOString(),consoleUrl:this.url.href,backupStatusVerified:false};}
}
