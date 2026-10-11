const text=value=>typeof value==='string'?value.slice(0,240):'';
export function resourcesFrom(items){
  return items.filter(r=>typeof r.id==='string'&&typeof r.tenant_id==='string').map(r=>({id:r.id,tenantId:r.tenant_id,tenant:text(r.tenant_name),name:text(r.user_defined_name)||text(r.name)||'Unnamed resource',type:text(r.type),cti:text(r.cti)}));
}
export function tasksFrom(items){
  return items.map(t=>({id:text(t.uuid)||String(t.id??''),tenantId:text(t.tenant?.id),tenant:text(t.tenant?.name),type:text(t.type),title:text(t.context?.title)||text(t.context?.Persistent?.Name)||text(t.type),state:text(t.state)||'Not reported',result:text(t.result?.code)||'Not reported',startedAt:text(t.startedAt),completedAt:text(t.completedAt),updatedAt:text(t.updatedAt)})).filter(t=>t.id);
}

// Backup task type confirmed by the tenant's completed backup and recovery test.
export const backupTaskType='D332948D-A7A9-4E07-B76C-253DCF6E17FB';
const guid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function backupResults(resources,tasks){
  const ids=new Map();
  for(const resource of resources){
    for(const value of [resource.id,resource.external_id]){
      if(typeof value!=='string'||!guid.test(value))continue;
      const key=value.toLowerCase();if(!ids.has(key))ids.set(key,new Set());ids.get(key).add(resource.id);
    }
  }
  const matched=[];
  for(const task of tasks){
    if(String(task.type).toUpperCase()!==backupTaskType)continue;
    const references=new Set();
    const specific=typeof task.context?.Specific==='string'?task.context.Specific.slice(0,200000):'';
    for(const value of [task.issuer?.id,...(specific.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi)||[])]){
      if(typeof value!=='string')continue;
      for(const id of ids.get(value.toLowerCase())||[])references.add(id);
    }
    // A plan task naming several resources is not a per-device success result.
    if(references.size!==1)continue;
    const resourceId=[...references][0];
    matched.push({...tasksFrom([task])[0],resourceId});
  }
  return resources.map(resource=>{
    const related=matched.filter(t=>t.resourceId===resource.id);
    const timestamp=t=>Date.parse(t.completedAt||t.updatedAt||t.startedAt)||0;
    related.sort((a,b)=>timestamp(b)-timestamp(a));
    const successful=related.filter(t=>t.state==='completed'&&t.result==='ok'&&Number.isFinite(Date.parse(t.completedAt))).sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt));
    return {resourceId:resource.id,latestTask:related[0]||null,lastSuccessfulTaskAt:successful[0]?.completedAt||null};
  });
}
