const { REST, Routes } = require("discord.js");

function createPublisher(client, guildId, { rest: suppliedRest, itChannelId } = {}) {
  // Keep network attempts shorter than the durable lease. In particular, do not let the
  // main bot's REST queue hold an announcement through a long rate limit and send it later.
  const rest = suppliedRest || new REST({ version: "10", timeout: 8000, retries: 0, rejectOnRateLimit: () => true });
  const api = () => suppliedRest || rest.setToken(client.token);
  let resolvedItChannel = itChannelId;
  async function getChannel(id) {
    const channel = await api().get(Routes.channel(id));
    if (channel?.guild_id !== guildId || ![0, 5, 10, 11, 12].includes(channel.type)) throw new Error("invalid_streaming_channel");
  }
  return {
    async reportError(alert) {
      if (!resolvedItChannel) {
        const matches = (await api().get(Routes.guildChannels(guildId))).filter((channel) => channel.name === "it" && channel.type === 0);
        if (matches.length !== 1) throw new Error("streaming_it_channel_not_found");
        resolvedItChannel = matches[0].id;
      }
      await getChannel(resolvedItChannel);
      await api().post(Routes.channelMessages(resolvedItChannel), { body: {
        content: `⚠️ DZR Streaming · ${alert.discordId ? `<@${alert.discordId}>` : "system"} · ${alert.code}\nFejl registreret: <t:${Math.floor(alert.createdAt / 1000)}:f>. Se /streaming_overview.`,
        allowed_mentions: { parse: [] }, nonce: alert.id.slice(-24), enforce_nonce: true,
      } });
    },
    async send(notice, message) {
      await getChannel(notice.channelId);
      const { allowedMentions, ...body } = message;
      return (await api().post(Routes.channelMessages(notice.channelId), { body: {
        ...body, allowed_mentions: allowedMentions, nonce: notice.nonce, enforce_nonce: true,
      } })).id;
    },
    async edit(notice, message) {
      await getChannel(notice.channelId);
      if (!notice.messageId) throw new Error("missing_streaming_message");
      const { allowedMentions: _allowedMentions, ...body } = message;
      try {
        await api().patch(Routes.channelMessage(notice.channelId, notice.messageId), { body: {
          content: "", embeds: [], components: [], ...body, allowed_mentions: { parse: [] },
        } });
        return { deleted: false };
      } catch (error) {
        // A moderator may remove the announcement. Never recreate it through the edit path.
        if (error.status === 404 || error.code === 10008) return { deleted: true };
        throw error;
      }
    },
    async findExisting(notice) {
      await getChannel(notice.channelId);
      const expectedEmbeds = notice.initialMessage?.embeds
        || (notice.stream ? [{ url: notice.stream.url, timestamp: notice.stream.startedAt }] : []);
      const fingerprints = expectedEmbeds.filter((embed) => embed.url && Number.isFinite(Date.parse(embed.timestamp)));
      let before;
      // Covers a busy channel and resumes safely after process death between send and receipt storage.
      for (let page = 0; page < 10; page++) {
        const messages = await api().get(Routes.channelMessages(notice.channelId), {
          query: new URLSearchParams({ limit: "100", ...(before ? { before } : {}) }),
        });
        if (!messages.length) return { complete: true };
        for (const message of messages) {
          if (message.author?.id === client.user.id && fingerprints.length && fingerprints.every((expected) =>
            (message.embeds || []).some((embed) => embed.url === expected.url
              && Date.parse(embed.timestamp) === Date.parse(expected.timestamp)))) return { complete: true, messageId: message.id };
        }
        const oldest = messages.reduce((a, b) => Date.parse(a.timestamp) < Date.parse(b.timestamp) ? a : b);
        if (Date.parse(oldest.timestamp) < notice.firstAttemptAt - 5000 || messages.length < 100) return { complete: true };
        before = oldest.id;
      }
      return { complete: false };
    },
  };
}

module.exports = { createPublisher };
