const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const AuthSession = require('../models/AuthSession');
const AdminRecoveryConsumption = require('../models/AdminRecoveryConsumption');
const { hashPassword, sha256Hex } = require('../utils/passwords');
const { recordAudit } = require('../utils/audit');
const { withBusinessAdminGuard, countOtherActiveAdmins } = require('../services/adminGuard');

/**
 * Start-up admin bootstrap and break-glass recovery.
 *
 * Normal start (ADMIN_RECOVERY unset):
 * - First run: when the bootstrap business has no admin account at all, the
 *   ADMIN_EMAIL account is created.
 * - Afterwards the environment never changes accounts. A bootstrap admin that
 *   was deliberately demoted, deactivated or deleted by another admin is NOT
 *   silently resurrected, and such a change never blocks server start-up.
 *   If the business has no active admin left, a clear error is logged with the
 *   recovery instructions.
 *
 * Recovery — one-time, explicitly authorised (security findings M3 / L2):
 *   ADMIN_RECOVERY=true
 *   ADMIN_RECOVERY_TOKEN=<fresh random value, ≥ 32 characters, used once>
 *   ADMIN_EMAIL / ADMIN_PASSWORD (new password, ≥ 14 characters)
 *   ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS=true   (emergency only, see below)
 *
 * - Every token works exactly once. Its SHA-256 is stored together with the
 *   account change, so a leftover flag on later restarts, or a second API
 *   instance starting concurrently, changes nothing.
 * - Recovery is refused while the business has another active admin (that
 *   admin can restore the account through the UI). Only the explicit
 *   ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS=true emergency switch — e.g. the
 *   other admin account is compromised — lifts this, and it is audited.
 * - The ADMIN_EMAIL account is (re)created, or re-activated and promoted;
 *   its password hash is replaced, tokenVersion incremented, all refresh
 *   sessions and reset tokens invalidated, and the mandatory audit record
 *   written — all in ONE transaction. If any step (including the audit write)
 *   fails, nothing is changed and start-up fails.
 * - An account that already is an active admin is left untouched (the token
 *   is still consumed and the attempt audited).
 * - Credentials and tokens are never logged.
 */
const { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH } = require('../config/tenancy');
const MIN_ADMIN_PASSWORD_LENGTH = 14;
const MIN_RECOVERY_TOKEN_LENGTH = 32;
const TRUTHY = ['1', 'true', 'yes', 'on'];

const truthy = (value) => TRUTHY.includes(String(value ?? '').trim().toLowerCase());

function readBootstrapEnv(env) {
  return {
    email: String(env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: String(env.ADMIN_PASSWORD || ''),
    name: env.ADMIN_NAME || 'Sistem Yöneticisi',
    recovery: truthy(env.ADMIN_RECOVERY),
    recoveryToken: String(env.ADMIN_RECOVERY_TOKEN || '').trim(),
    overrideActiveAdmins: truthy(env.ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS),
  };
}

async function createAdmin({ email, password, name }, businessId) {
  try {
    return await User.create({
      email,
      name,
      passwordHash: await hashPassword(password),
      role: 'admin',
      businessId,
      branch: DEFAULT_BRANCH,
      active: true,
    });
  } catch (error) {
    // Another API instance created it at the same moment.
    if (error?.code === 11000) return User.findOne({ email });
    throw error;
  }
}

const RECOVERY_INSTRUCTIONS = 'Kurtarmak için ADMIN_RECOVERY=true ve yeni, tek kullanımlık bir ADMIN_RECOVERY_TOKEN ile bir kez başlatın.';

async function runRecovery(config, { logger, defaultBusinessId }) {
  if (!config.recoveryToken) {
    logger.error('[bootstrap] ADMIN_RECOVERY etkin ancak ADMIN_RECOVERY_TOKEN tanımlı değil; kurtarma YAPILMADI. '
      + 'Kurtarma yalnızca tek kullanımlık bir token ile yetkilendirilebilir.');
    return { action: 'recovery_refused', reason: 'token_missing' };
  }
  if (config.recoveryToken.length < MIN_RECOVERY_TOKEN_LENGTH || config.recoveryToken === config.password) {
    throw new Error(`ADMIN_RECOVERY_TOKEN en az ${MIN_RECOVERY_TOKEN_LENGTH} karakterli, ADMIN_PASSWORD'dan farklı rastgele bir değer olmalıdır.`);
  }
  const tokenHash = sha256Hex(config.recoveryToken);
  const consumedMessage = '[bootstrap] ADMIN_RECOVERY_TOKEN daha önce kullanılmış; değişiklik yapılmadı. '
    + 'ADMIN_RECOVERY ve ADMIN_RECOVERY_TOKEN değişkenlerini kaldırın.';

  // Collections must exist before they are written inside a transaction.
  await Promise.all([AdminRecoveryConsumption.init(), AuditLog.init()]);
  if (await AdminRecoveryConsumption.exists({ _id: tokenHash })) {
    logger.warn(consumedMessage);
    return { action: 'recovery_token_consumed' };
  }

  const existing = await User.findOne({ email: config.email }).lean();
  const businessId = existing?.businessId || defaultBusinessId;
  // CPU-heavy, and the transaction body may be retried.
  const passwordHash = await hashPassword(config.password);

  const outcome = await withBusinessAdminGuard(businessId, async (session) => {
    if (await AdminRecoveryConsumption.exists({ _id: tokenHash }).session(session)) {
      return { action: 'recovery_token_consumed' };
    }
    const target = await User.findOne({ email: config.email }).session(session);
    if (target && (target.businessId || '') !== businessId) {
      throw new Error('ADMIN_EMAIL hesabı kurtarma sırasında değişti; işlem iptal edildi.');
    }

    const consume = async (userId, result) => {
      await AdminRecoveryConsumption.create([{
        _id: tokenHash,
        businessId,
        userId,
        outcome: result,
        overrideActiveAdmins: config.overrideActiveAdmins,
      }], { session });
    };
    const audit = (userId, action, before, after) => recordAudit({
      AuditLog,
      session,
      actorUserId: userId,
      action,
      resourceType: 'User',
      resourceId: userId,
      correlationId: 'bootstrap-admin-recovery',
      before,
      after,
    });

    if (target && target.role === 'admin' && target.active === true) {
      await consume(target._id, 'already_active');
      await audit(target._id, 'user.admin_recovery_skipped', undefined, { reason: 'already_active_admin' });
      return { action: 'none', userId: target._id, reason: 'already_active_admin' };
    }

    const otherActiveAdmins = await countOtherActiveAdmins(businessId, target?._id ?? null, session);
    if (otherActiveAdmins > 0 && !config.overrideActiveAdmins) {
      return { action: 'recovery_refused', reason: 'active_admin_exists', userId: target?._id };
    }
    const authorization = {
      method: 'one_time_token',
      overrideActiveAdmins: config.overrideActiveAdmins,
      otherActiveAdmins,
    };

    if (!target) {
      const [created] = await User.create([{
        email: config.email,
        name: config.name,
        passwordHash,
        role: 'admin',
        businessId,
        branch: DEFAULT_BRANCH,
        active: true,
      }], { session });
      await consume(created._id, 'recovered_created');
      await audit(created._id, 'user.admin_recovery', undefined, { created: true, role: 'admin', active: true, ...authorization });
      return { action: 'recovered_created', userId: created._id };
    }

    const now = new Date();
    // Concurrent writes to this account conflict with the snapshot transaction.
    const updated = await User.updateOne(
      { _id: target._id },
      {
        $set: { role: 'admin', active: true, passwordHash, passwordChangedAt: now },
        $inc: { tokenVersion: 1 },
        $unset: {
          passwordResetTokenHash: 1,
          passwordResetExpires: 1,
          passwordResetRequestedAt: 1,
          passwordResetTokenVersion: 1,
        },
      },
      { session },
    );
    if (updated.modifiedCount !== 1) throw new Error('ADMIN_EMAIL hesabı kurtarma sırasında değişti; işlem iptal edildi.');
    const revoked = await AuthSession.updateMany(
      { userId: target._id, revokedAt: null },
      { $set: { revokedAt: now, revokedReason: 'admin_recovery' } },
      { session },
    );
    await consume(target._id, 'recovered');
    await audit(
      target._id,
      'user.admin_recovery',
      { role: target.role, active: target.active },
      {
        role: 'admin',
        active: true,
        passwordReplaced: true,
        tokenVersionIncremented: true,
        sessionsRevoked: revoked.modifiedCount,
        resetTokensInvalidated: true,
        ...authorization,
      },
    );
    return { action: 'recovered', userId: target._id };
  });

  switch (outcome.action) {
    case 'recovery_token_consumed':
      logger.warn(consumedMessage);
      break;
    case 'recovery_refused':
      logger.error('[bootstrap] ADMIN_RECOVERY reddedildi: işletmede başka aktif yönetici var. Hesabı o yönetici arayüzden '
        + 'yeniden etkinleştirebilir. Yalnızca acil durumda ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS=true kullanın.');
      break;
    case 'none':
      logger.warn('[bootstrap] ADMIN_RECOVERY: ADMIN_EMAIL zaten aktif yönetici; hesap değiştirilmedi, token kullanıldı. '
        + 'ADMIN_RECOVERY ve ADMIN_RECOVERY_TOKEN değişkenlerini kaldırın.');
      break;
    default:
      logger.warn(`[bootstrap] ADMIN_RECOVERY: yönetici hesabı ${outcome.action === 'recovered_created' ? 'yeniden oluşturuldu' : 'etkinleştirildi'}; `
        + 'şifresi ADMIN_PASSWORD ile değiştirildi, tüm oturum ve sıfırlama tokenları geçersiz kılındı, işlem denetim kaydına yazıldı. '
        + 'ADMIN_RECOVERY, ADMIN_RECOVERY_TOKEN ve ADMIN_PASSWORD değişkenlerini kaldırın.');
  }
  return outcome;
}

async function bootstrapAdmin({ env = process.env, logger = console, businessId: defaultBusinessId = DEFAULT_BUSINESS_ID } = {}) {
  const config = readBootstrapEnv(env);

  if (!config.email && !config.password) {
    if (config.recovery) throw new Error('ADMIN_RECOVERY için ADMIN_EMAIL ve ADMIN_PASSWORD tanımlanmalıdır.');
    const existingAdmin = await User.exists({ role: 'admin', active: true });
    if (existingAdmin) return { action: 'none' };
    throw new Error('İlk yönetici için ADMIN_EMAIL ve ADMIN_PASSWORD tanımlanmalıdır.');
  }
  if (!config.email || config.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_EMAIL ve en az ${MIN_ADMIN_PASSWORD_LENGTH} karakterli ADMIN_PASSWORD birlikte tanımlanmalıdır.`);
  }

  if (config.recovery) return runRecovery(config, { logger, defaultBusinessId });
  if (config.recoveryToken) {
    logger.warn('[bootstrap] ADMIN_RECOVERY_TOKEN tanımlı fakat ADMIN_RECOVERY etkin değil; yok sayıldı. Değişkeni kaldırın.');
  }

  const existing = await User.findOne({ email: config.email });
  const businessId = existing?.businessId || defaultBusinessId;

  if (!existing) {
    // First run only: never resurrect a bootstrap admin that was deleted later.
    const anyAdmin = await User.exists({ businessId, role: 'admin' });
    if (anyAdmin) {
      if (!(await User.exists({ businessId, role: 'admin', active: true }))) {
        logger.error(`[bootstrap] İşletmede aktif yönetici yok. ${RECOVERY_INSTRUCTIONS}`);
      }
      return { action: 'none' };
    }
    const created = await createAdmin(config, businessId);
    logger.log('İlk yönetici hesabı oluşturuldu.');
    return { action: 'created', userId: created._id };
  }

  if (existing.role !== 'admin' || existing.active !== true) {
    // A deliberate demotion/deactivation by another admin must not brick start-up.
    const activeAdmin = await User.exists({ businessId, role: 'admin', active: true });
    if (activeAdmin) {
      logger.warn('[bootstrap] ADMIN_EMAIL hesabı aktif bir yönetici değil; ortam değişkeni ile değişiklik yapılmadı.');
    } else {
      logger.error(`[bootstrap] İşletmede aktif yönetici yok. ${RECOVERY_INSTRUCTIONS}`);
    }
    return { action: 'none', userId: existing._id };
  }
  return { action: 'none', userId: existing._id };
}

module.exports = bootstrapAdmin;
module.exports.MIN_RECOVERY_TOKEN_LENGTH = MIN_RECOVERY_TOKEN_LENGTH;
