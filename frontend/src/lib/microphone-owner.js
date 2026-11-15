let owner = null;
export function claimMicrophone(onRevoke) {
  const previous = owner; owner = null; previous?.revoke();
  const claim = { revoke: onRevoke }; owner = claim;
  return () => { if (owner === claim) owner = null; };
}
