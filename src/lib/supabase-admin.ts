import pool from './db';

interface SupabaseRequestInit extends RequestInit {
  searchParams?: Record<string, string>;
}

export async function supabaseAdminFetch<T>(
  table: string,
  options: SupabaseRequestInit = {}
): Promise<T> {
  const { searchParams = {}, method = 'GET', body } = options;
  const { select, order, limit, ...filters } = searchParams;

  const cols = select
    ? select.split(',').map(c => `"${c.trim()}"`).join(', ')
    : '*';

  if (method === 'GET') {
    const conditions: string[] = [];
    const values: unknown[] = [];

    for (const [key, val] of Object.entries(filters)) {
      if (key === 'or') {
        const inner = val.replace(/^\(|\)$/g, '');
        const orClauses: string[] = [];
        for (const part of inner.split(',')) {
          const m = part.match(/^(\w+)\.ilike\.\*(.+)\*$/);
          if (m) {
            values.push(`%${m[2]}%`);
            orClauses.push(`"${m[1]}" ILIKE $${values.length}`);
          }
        }
        if (orClauses.length) conditions.push(`(${orClauses.join(' OR ')})`);
      } else if (val === 'not.is.null') {
        conditions.push(`"${key}" IS NOT NULL`);
      } else if (val === 'is.null') {
        conditions.push(`"${key}" IS NULL`);
      } else if (val.startsWith('eq.')) {
        values.push(val.slice(3));
        conditions.push(`"${key}" = $${values.length}`);
      } else if (val.startsWith('neq.')) {
        values.push(val.slice(4));
        conditions.push(`"${key}" != $${values.length}`);
      }
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let orderSql = '';
    if (order) {
      const parts = order.split(',').map(o => {
        const [col, dir] = o.split('.');
        return `"${col}" ${dir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
      });
      orderSql = `ORDER BY ${parts.join(', ')}`;
    }
    const limitSql = limit ? `LIMIT ${parseInt(limit)}` : '';

    const sql = `SELECT ${cols} FROM "${table}" ${whereSql} ${orderSql} ${limitSql}`.trim();
    const result = await pool.query(sql, values);
    return result.rows as T;
  }

  if (method === 'POST') {
    const data = JSON.parse(body as string) as Record<string, unknown>;
    const keys = Object.keys(data);
    const colsSql = keys.map(k => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const vals = keys.map(k => {
      const v = data[k];
      return (Array.isArray(v) || (typeof v === 'object' && v !== null)) ? JSON.stringify(v) : v;
    });
    const sql = `INSERT INTO "${table}" (${colsSql}) VALUES (${placeholders}) RETURNING ${cols}`;
    const result = await pool.query(sql, vals);
    return result.rows as T;
  }

  if (method === 'PATCH') {
    const data = JSON.parse(body as string) as Record<string, unknown>;
    const values: unknown[] = [];
    const sets: string[] = [];
    for (const [k, v] of Object.entries(data)) {
      values.push((Array.isArray(v) || (typeof v === 'object' && v !== null)) ? JSON.stringify(v) : v);
      sets.push(`"${k}" = $${values.length}`);
    }
    const conditions: string[] = [];
    for (const [key, val] of Object.entries(filters)) {
      if (val.startsWith('eq.')) {
        values.push(val.slice(3));
        conditions.push(`"${key}" = $${values.length}`);
      }
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `UPDATE "${table}" SET ${sets.join(', ')} ${whereSql} RETURNING ${cols}`;
    const result = await pool.query(sql, values);
    return result.rows as T;
  }

  if (method === 'DELETE') {
    const conditions: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(filters)) {
      if (val.startsWith('eq.')) {
        values.push(val.slice(3));
        conditions.push(`"${key}" = $${values.length}`);
      }
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    await pool.query(`DELETE FROM "${table}" ${whereSql}`, values);
    return undefined as T;
  }

  throw new Error(`Unsupported method: ${method}`);
}
