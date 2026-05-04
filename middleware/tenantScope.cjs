function getSchemaForUser(user) {
  if ((user?.plant || '').toLowerCase().includes('france')) return 'schema_fr';
  return 'public';
}

function isManagerRole(role) {
  const r = (role || '').toLowerCase();
  return r === 'responsable1' || r === 'responsable2' || r === 'manager';
}

function employeeScopeClause(user, alias = 'e', startIndex = 1) {
  const clauses = [];
  const params = [];
  let i = startIndex;

  if (user?.tenant_id) {
    clauses.push(`${alias}.site_dep = $${i++}`);
    params.push(user.plant || user.tenant_id);
  }

  if (isManagerRole(user?.role)) {
    clauses.push(`(${alias}.mail_responsable1 = $${i} OR ${alias}.mail_responsable2 = $${i})`);
    params.push(user.email);
    i++;
  }

  return { clause: clauses.length ? clauses.join(' AND ') : '1=1', params, nextIndex: i };
}

module.exports = { getSchemaForUser, isManagerRole, employeeScopeClause };

