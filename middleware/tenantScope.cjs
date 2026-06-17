const COUNTRY_SCHEMA_MAP = {
  tunisia: 'public',
  france: 'schema_fr',
  china: 'schema_cn',
  germany: 'schema_de',
  india: 'schema_in',
  luxembourg: 'schema_lu',
  mexico: 'schema_mx',
  'south korea': 'schema_kr',
  korea: 'schema_kr'
};

const ALL_EMPLOYEE_SCHEMAS = [
  'public',
  'schema_fr',
  'schema_cn',
  'schema_de',
  'schema_in',
  'schema_lu',
  'schema_mx',
  'schema_kr'
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function isGroupRole(role) {
  const r = normalize(role);
  return ['group_hr', 'hr_group', 'hr_manager_group', 'global_hr', 'super_admin'].includes(r);
}

function isManagerRole(role) {
  const r = normalize(role);
  return r === 'responsable1' || r === 'responsable2' || r === 'manager';
}

function inferCountryKey(user) {
  const candidates = [
    user?.country,
    user?.plant,
    user?.site,
    user?.tenant_label,
    user?.tenant_name
  ]
    .map(normalize)
    .filter(Boolean)
    .join(' ');

  if (!candidates) return null;
  if (candidates.includes('south korea') || candidates.includes('korea')) return 'south korea';
  if (candidates.includes('france')) return 'france';
  if (candidates.includes('china') || candidates.includes('tianjin') || candidates.includes('kunshan') || candidates.includes('anhui')) return 'china';
  if (candidates.includes('germany')) return 'germany';
  if (candidates.includes('india')) return 'india';
  if (candidates.includes('luxembourg')) return 'luxembourg';
  if (candidates.includes('mexico')) return 'mexico';
  if (candidates.includes('tunisia') || candidates.includes('sts') || candidates.includes('sceet') || candidates.includes('same service') || candidates.includes('same-service')) return 'tunisia';
  return null;
}

function getSchemaForUser(user) {
  const countryKey = inferCountryKey(user);
  if (countryKey && COUNTRY_SCHEMA_MAP[countryKey]) return COUNTRY_SCHEMA_MAP[countryKey];
  return 'public';
}

function getAccessibleEmployeeSchemas(user) {
  if (isGroupRole(user?.role)) return ALL_EMPLOYEE_SCHEMAS;
  return [getSchemaForUser(user)];
}

function employeeScopeClause(user, alias = 'e', startIndex = 1) {
  const clauses = [];
  const params = [];
  let i = startIndex;
  const schema = getSchemaForUser(user);

  if (user?.tenant_id && !isGroupRole(user?.role) && schema === 'public') {
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

module.exports = {
  ALL_EMPLOYEE_SCHEMAS,
  COUNTRY_SCHEMA_MAP,
  getAccessibleEmployeeSchemas,
  getSchemaForUser,
  inferCountryKey,
  isGroupRole,
  isManagerRole,
  employeeScopeClause
};

