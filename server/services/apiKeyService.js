import crypto from 'crypto';
import { getDatabase } from '../database/index.js';

function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey || '')).digest('hex');
}

function generateRawApiKey() {
  return `sk-seedance-${crypto.randomBytes(24).toString('hex')}`;
}

function maskPrefix(rawKey) {
  const text = String(rawKey || '');
  return text.length <= 16 ? text : `${text.slice(0, 12)}...${text.slice(-4)}`;
}

function mapApiKey(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: row.name || '',
    keyPrefix: row.key_prefix || '',
    status: row.status || 'active',
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

class ApiKeyService {
  listUserApiKeys(userId) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, user_id, name, key_prefix, status, last_used_at, created_at, updated_at
      FROM api_keys
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(Number(userId));

    return rows.map(mapApiKey);
  }

  createApiKey(userId, name = '默认 OpenAPI Key') {
    const db = getDatabase();
    const trimmedName = String(name || '').trim() || '默认 OpenAPI Key';
    const rawKey = generateRawApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = maskPrefix(rawKey);

    const result = db.prepare(`
      INSERT INTO api_keys (user_id, name, key_hash, key_prefix, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(Number(userId), trimmedName, keyHash, keyPrefix);

    const created = db.prepare(`
      SELECT id, user_id, name, key_prefix, status, last_used_at, created_at, updated_at
      FROM api_keys
      WHERE id = ?
    `).get(result.lastInsertRowid);

    return {
      ...mapApiKey(created),
      apiKey: rawKey,
    };
  }

  deleteApiKey(id, userId) {
    const db = getDatabase();
    const result = db.prepare(`
      DELETE FROM api_keys
      WHERE id = ? AND user_id = ?
    `).run(Number(id), Number(userId));

    if (result.changes === 0) {
      throw new Error('API Key 不存在或无权删除');
    }

    return { success: true };
  }

  authenticateApiKey(rawKey) {
    const db = getDatabase();
    const keyHash = hashApiKey(rawKey);
    const row = db.prepare(`
      SELECT
        k.id,
        k.user_id,
        k.name,
        k.key_prefix,
        k.status AS key_status,
        u.id AS user_id_ref,
        u.email,
        u.role,
        u.status AS user_status,
        u.credits
      FROM api_keys k
      JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = ?
      LIMIT 1
    `).get(keyHash);

    if (!row) {
      return null;
    }

    if (row.key_status !== 'active' || row.user_status !== 'active') {
      return null;
    }

    db.prepare(`
      UPDATE api_keys
      SET last_used_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(row.id));

    return {
      apiKey: {
        id: Number(row.id),
        userId: Number(row.user_id),
        name: row.name || '',
        keyPrefix: row.key_prefix || '',
      },
      user: {
        id: Number(row.user_id_ref),
        email: row.email,
        role: row.role,
        status: row.user_status,
        credits: Number(row.credits || 0),
      },
    };
  }
}

export default new ApiKeyService();
