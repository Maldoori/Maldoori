const text=value=>typeof value==='string'?value.slice(0,240):'';
export function resourcesFrom(items){
  return items.filter(r=>typeof r.id==='string'&&typeof r.tenant_id==='string').map(r=>({id:r.id,tenantId:r.tenant_id,tenant:text(r.tenant_name),name:text(r.user_defined_name)||text(r.name)||'Unnamed resource',type:text(r.type),cti:text(r.cti)}));
}
export function tasksFrom(items){
  return items.map(t=>({id:text(t.uuid)||String(t.id??''),tenantId:text(t.tenant?.id),tenant:text(t.tenant?.name),type:text(t.type),title:text(t.context?.title)||text(t.context?.Persistent?.Name)||text(t.type),state:text(t.state)||'Not reported',result:text(t.result?.code)||'Not reported',startedAt:text(t.startedAt),completedAt:text(t.completedAt),updatedAt:text(t.updatedAt)})).filter(t=>t.id);
}
