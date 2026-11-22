const { db, getUserZwiftId } = require('./firebase');
const { DEFAULT_VERIFICATION_CRITERIA, evaluateVerificationCriteria } = require('./verificationCriteria');

class VerificationService {
  constructor() {
    this.collection = "verificationSettings";
    this.defaultCriteria = DEFAULT_VERIFICATION_CRITERIA;
    this.pendingVerifications = new Map();
  }

  /**
   * Get verification settings for a guild
   */
  async getVerificationSettings(guildId) {
    try {
      const doc = await db.collection(this.collection).doc(guildId).get();
      if (!doc.exists) {
        return {
          enabled: false,
          verifiedRoleId: null,
          criteria: this.defaultCriteria
        };
      }
      return doc.data();
    } catch (error) {
      console.error("Error getting verification settings:", error);
      return null;
    }
  }

  /**
   * Set verification settings for a guild
   */
  async setVerificationSettings(guildId, settings) {
    try {
      const data = {
        guildId,
        enabled: settings.enabled || false,
        verifiedRoleId: settings.verifiedRoleId,
        criteria: { ...this.defaultCriteria, ...settings.criteria },
        updatedAt: new Date()
      };

      await db.collection(this.collection).doc(guildId).set(data);
      return true;
    } catch (error) {
      console.error("Error setting verification settings:", error);
      return false;
    }
  }

  /**
   * Check if a member meets verification criteria
   */
  async checkVerificationCriteria(member, criteria) {
    // Capture Discord facts before the database read: an event can update the cache while we await.
    const facts = {
      accountCreatedAt: member.user.createdTimestamp,
      roleIds: [...member.roles.cache.keys()],
      isServerBooster: member.premiumSince != null,
      zwiftId: criteria.requiresZwiftId ? await getUserZwiftId(member.user.id) : null,
    };
    // Let lookup errors reach the caller. They must never be interpreted as ineligibility.
    return evaluateVerificationCriteria(criteria, facts);
  }

  /**
   * Process verification for a member (assign or remove verified role)
   */
  async processVerification(member) {
    const key = `${member.guild.id}:${member.id}`;
    const previous = this.pendingVerifications.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.processCurrentVerification(member));
    this.pendingVerifications.set(key, current);
    try {
      return await current;
    } finally {
      if (this.pendingVerifications.get(key) === current) this.pendingVerifications.delete(key);
    }
  }

  async processCurrentVerification(member) {
    try {
      const settings = await this.getVerificationSettings(member.guild.id);
      
      if (!settings) return { processed: false, reason: "Verification lookup failed" };
      if (!settings.enabled || !settings.verifiedRoleId) {
        return { processed: false, reason: "Verification not configured" };
      }

      // Check if the verified role exists
      const verifiedRole = member.guild.roles.cache.get(settings.verifiedRoleId);
      if (!verifiedRole) {
        console.error(`Verified role ${settings.verifiedRoleId} not found in guild ${member.guild.id}`);
        return { processed: false, reason: "Verified role not found" };
      }

      // Every entry point uses fresh Discord state after entering the per-member queue.
      // Read the role state before the database: a delayed event must not undo a newer assignment.
      member = await member.guild.members.fetch({ user: member.id, force: true });
      const hasVerifiedRole = member.roles.cache.has(settings.verifiedRoleId);
      const criteria = { ...this.defaultCriteria, ...settings.criteria };
      const criteriaCheck = await this.checkVerificationCriteria(member, criteria);

      if (criteriaCheck.meetsAllCriteria && !hasVerifiedRole) {
        // User meets criteria but doesn't have the role - assign it
        await member.roles.add(settings.verifiedRoleId);
        console.log(`✅ Auto-assigned verified role to ${member.user.username} (${member.user.id})`);
        
        return {
          processed: true,
          action: "role_assigned",
          role: verifiedRole.name,
          criteria: criteriaCheck.criteriaResults
        };
        
      } else if (!criteriaCheck.meetsAllCriteria && hasVerifiedRole) {
        // User doesn't meet criteria but has the role - remove it
        await member.roles.remove(settings.verifiedRoleId);
        console.log(`❌ Auto-removed verified role from ${member.user.username} (${member.user.id}). Missing: ${criteriaCheck.missingCriteria.join(', ')}`);
        
        return {
          processed: true,
          action: "role_removed",
          role: verifiedRole.name,
          missingCriteria: criteriaCheck.missingCriteria
        };
      }

      return {
        processed: false,
        reason: criteriaCheck.meetsAllCriteria ? "Already has role" : "Doesn't meet criteria",
        missingCriteria: criteriaCheck.missingCriteria
      };

    } catch (error) {
      console.error("Error processing verification:", error);
      return { processed: false, reason: "Error processing", error: error.message };
    }
  }

  /**
   * Check and update verification status for all members in a guild
   */
  async processGuildVerification(guild) {
    try {
      const settings = await this.getVerificationSettings(guild.id);
      
      if (!settings || !settings.enabled) {
        return { processed: false, reason: "Verification not enabled" };
      }

      console.log(`🔍 Processing verification for all members in ${guild.name}`);
      
      const results = {
        processed: 0,
        rolesAssigned: 0,
        rolesRemoved: 0,
        errors: 0
      };

      // Fetch all guild members
      const members = await guild.members.fetch();
      
      for (const member of members.values()) {
        if (member.user.bot) continue; // Skip bots
        
        try {
          const result = await this.processVerification(member);
          if (result.processed) {
            results.processed++;
            if (result.action === "role_assigned") {
              results.rolesAssigned++;
            } else if (result.action === "role_removed") {
              results.rolesRemoved++;
            }
          }
        } catch (error) {
          console.error(`Error processing verification for ${member.user.username}:`, error);
          results.errors++;
        }
      }

      console.log(`✅ Verification processing complete for ${guild.name}: ${results.rolesAssigned} assigned, ${results.rolesRemoved} removed, ${results.errors} errors`);
      return results;

    } catch (error) {
      console.error("Error processing guild verification:", error);
      return { processed: false, reason: "Error processing guild", error: error.message };
    }
  }

  /**
   * Get verification status for a specific member
   */
  async getVerificationStatus(member) {
    try {
      const settings = await this.getVerificationSettings(member.guild.id);
      
      if (!settings) return null;
      if (!settings.enabled) {
        return {
          enabled: false,
          hasVerifiedRole: false,
          meetsAllCriteria: false,
          criteriaResults: {},
          missingCriteria: []
        };
      }

      const hasVerifiedRole = member.roles.cache.has(settings.verifiedRoleId);
      const criteriaCheck = await this.checkVerificationCriteria(member, { ...this.defaultCriteria, ...settings.criteria });

      return {
        enabled: true,
        verifiedRoleName: member.guild.roles.cache.get(settings.verifiedRoleId)?.name,
        hasVerifiedRole,
        meetsAllCriteria: criteriaCheck.meetsAllCriteria,
        criteriaResults: criteriaCheck.criteriaResults,
        missingCriteria: criteriaCheck.missingCriteria
      };

    } catch (error) {
      console.error("Error getting verification status:", error);
      return null;
    }
  }
}

module.exports = new VerificationService();
