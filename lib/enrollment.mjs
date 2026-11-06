// Never send an enrollment token to an unexpected destination.
export function validateInvitation(value, base) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('MeshCentral did not return an invitation.');
  let url;
  try { url = new URL(value, base); }
  catch { throw new Error('MeshCentral returned an invalid invitation destination.'); }
  const root = new URL(base);
  if (url.protocol !== 'https:' || url.origin !== root.origin || url.username || url.password || url.hash) {
    throw new Error('MeshCentral returned an unexpected invitation destination.');
  }
  const prefix = root.pathname.endsWith('/') ? root.pathname : root.pathname + '/';
  if (url.pathname !== prefix + 'agentinvite' || !url.searchParams.get('c')) {
    throw new Error('MeshCentral returned an invalid enrollment link.');
  }
  return url.href;
}
