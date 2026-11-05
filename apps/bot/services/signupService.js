const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { db, setBotState, getBotState } = require("./firebase");

// Legacy constants for default/legacy boards
const LETTER_EMOJIS = {
  A: "🇦",
  B: "🇧",
  C: "🇨",
  D: "🇩",
};
const EMOJI_TO_LETTER = Object.fromEntries(
  Object.entries(LETTER_EMOJIS).map(([k, v]) => [v, k])
);

function getSignupDocId(guildId, messageId) {
  return `${guildId}_${messageId}`;
}

async function getSignupConfig(configId) {
  if (!configId) return null;
  const snap = await db.collection("signup_board_configs").doc(configId).get();
  return snap.exists ? { id: configId, ...snap.data() } : null;
}

function normalizeEmojiName(name) {
  if (!name) return null;
  if (EMOJI_TO_LETTER[name]) return EMOJI_TO_LETTER[name];

  // Legacy support
  const upper = name.toUpperCase();
  if (["A", "B", "C", "D"].includes(upper)) return upper;

  return name;
}

async function getBoardByMessage(guildId, messageId) {
  const docId = getSignupDocId(guildId, messageId);
  const snap = await db.collection("signup_boards").doc(docId).get();
  return snap.exists ? { id: docId, ...snap.data() } : null;
}

async function getBoardByDocId(docId) {
  const snap = await db.collection("signup_boards").doc(docId).get();
  return snap.exists ? { id: docId, ...snap.data() } : null;
}

async function saveBoard(board) {
  const { id, ...data } = board;
  await db.collection("signup_boards").doc(id).set(data, { merge: true });
}

function renderSignupEmbed(board, guild, config) {
  let title, description, options;

  if (config) {
    title = config.title;
    description = config.description || "";
    options = config.options || [];
  } else {
    // Legacy Defaults
    title = "ZRL holdinteresser: A / B / C / D";
    description = "Reager nedenfor hvis du er interesseret i at køre for et ZRL hold i din division.\n" +
      `${LETTER_EMOJIS.D} = D • ${LETTER_EMOJIS.C} = C • ${LETTER_EMOJIS.B} = B • ${LETTER_EMOJIS.A} = A\n` +
      "Fjern din reaktion hvis du ikke længere er interesseret.";
    options = [
      { emoji: LETTER_EMOJIS.D, label: "Division D", value: "D" },
      { emoji: LETTER_EMOJIS.C, label: "Division C", value: "C" },
      { emoji: LETTER_EMOJIS.B, label: "Division B", value: "B" },
      { emoji: LETTER_EMOJIS.A, label: "Division A", value: "A" }
    ];
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865f2)
    .setFooter({ text: guild?.name || title })
    .setTimestamp();

  for (const opt of options) {
    const val = opt.value;
    const emoji = opt.emoji;
    const label = opt.label;

    const users = (board.signups[val] || []).filter(Boolean);
    const mentionList = users
      .slice(0, 20)
      .map((id) => `<@${id}>`)
      .join("\n");
    const extra = users.length > 20 ? `\n+${users.length - 20} more` : "";

    let fieldName = `${emoji} ${label} (${users.length})`;
    if (!config) {
      // Match legacy header logic "Division X (N)"
      fieldName = `Division ${val} (${users.length})`;
    }

    embed.addFields({
      name: fieldName,
      value: users.length ? `${mentionList}${extra}` : "—",
      inline: !!config,
    });
  }

  return embed;
}

function categoryOptions(config) {
  return Array.isArray(config?.options) ? config.options : [];
}

function renderSignupComponents(board, config) {
  if (!config) return []; // Legacy boards use reactions

  const rows = [];
  let currentRow = new ActionRowBuilder();

  // Discord allows max 5 buttons per row, max 5 rows
  categoryOptions(config).forEach((opt, index) => {
    if (index > 0 && index % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    const button = new ButtonBuilder()
      .setCustomId(`signup_${board.id}_${opt.value}`)
      .setLabel(opt.label)
      .setStyle(ButtonStyle.Primary);

    if (opt.emoji) {
      button.setEmoji(opt.emoji);
    }

    currentRow.addComponents(button);
  });

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

async function postSignupBoard(channel, configId = null) {
  const guildId = channel.guild.id;
  let config = null;

  if (configId) {
    config = await getSignupConfig(configId);
    if (!config) throw new Error(`Configuration '${configId}' not found.`);
    if (!categoryOptions(config).length) {
      throw new Error(`Template '${config.title || configId}' has no categories. Add them under Admin → Signup boards → Board templates.`);
    }
  }

  const signups = {};
  if (config) {
    categoryOptions(config).forEach(o => signups[o.value] = []);
  } else {
    ["A", "B", "C", "D"].forEach(d => signups[d] = []);
  }

  const initialBoard = {
    guildId,
    channelId: channel.id,
    messageId: null,
    configId: configId || null,
    signups,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const tempEmbed = renderSignupEmbed(initialBoard, channel.guild, config);
  const components = renderSignupComponents({ id: "temp", ...initialBoard }, config); // ID needed for button customId generation, but won't be correct yet. 

  // Issue: we need the message ID to generate the board ID to put in the button customId.
  // But we need to send the message to get the ID.
  // We can send without components first, then edit with components.

  const message = await channel.send({ embeds: [tempEmbed] });
  const boardId = getSignupDocId(guildId, message.id);

  const board = { id: boardId, ...initialBoard, messageId: message.id };
  await saveBoard(board);

  await setBotState(`signup_board_latest:${guildId}:${channel.id}`, {
    boardId,
    messageId: message.id,
    channelId: channel.id,
    guildId,
    updatedAt: Date.now(),
  });

  if (config) {
    // Update with buttons now that we have the correct boardId
    const realComponents = renderSignupComponents(board, config);
    await message.edit({ components: realComponents });
  } else {
    // Legacy reactions
    await message.react(LETTER_EMOJIS.D);
    await message.react(LETTER_EMOJIS.C);
    await message.react(LETTER_EMOJIS.B);
    await message.react(LETTER_EMOJIS.A);
  }

  return { board, message };
}

async function repostSignupBoard(channel, configId = null) {
  const guildId = channel.guild.id;
  let boardId = null;

  if (configId) {
    // Ultra-safe query: only filter by guildId to avoid ANY composite index requirements
    const snap = await db.collection("signup_boards")
      .where("guildId", "==", guildId)
      .get();

    // Filter by channelId and configId in memory
    const matchingDocs = snap.docs.filter(doc => {
      const data = doc.data();
      return data.channelId === channel.id && data.configId === configId;
    });

    if (matchingDocs.length === 0) {
      throw new Error(`No existing signup board with config '${configId}' found for this channel.`);
    }

    // Sort in memory
    const sortedDocs = matchingDocs.sort((a, b) => {
      const aTime = a.data().updatedAt || 0;
      const bTime = b.data().updatedAt || 0;
      return bTime - aTime;
    });

    boardId = sortedDocs[0].id;
  } else {
    // Fallback to absolute latest board in the channel
    const state = await getBotState(`signup_board_latest:${guildId}:${channel.id}`);
    if (!state?.boardId) {
      throw new Error("No existing signup board found for this channel.");
    }
    boardId = state.boardId;
  }

  const snap = await db.collection("signup_boards").doc(boardId).get();
  if (!snap.exists) {
    throw new Error("Signup board state refers to a missing record.");
  }
  const oldBoard = { id: boardId, ...snap.data() };

  let config = null;
  if (oldBoard.configId) {
    config = await getSignupConfig(oldBoard.configId);
  }

  // Create new message
  const embed = renderSignupEmbed(oldBoard, channel.guild, config);
  const message = await channel.send({ embeds: [embed] });

  // Create new board record linked to new message
  const newBoardId = getSignupDocId(guildId, message.id);

  // Explicitly copy signups to ensure we don't have reference issues or missing fields
  const signups = {};
  if (oldBoard.signups) {
    Object.keys(oldBoard.signups).forEach(key => {
      signups[key] = [...(oldBoard.signups[key] || [])];
    });
  }

  const newBoard = {
    ...oldBoard,
    id: newBoardId,
    messageId: message.id,
    signups: signups,
    updatedAt: Date.now()
  };

  console.log(`🔄 Reposting board: Carrying over signups for ${Object.keys(signups).length} options`);
  await saveBoard(newBoard);

  await setBotState(`signup_board_latest:${guildId}:${channel.id}`, {
    boardId: newBoardId,
    messageId: message.id,
    channelId: channel.id,
    guildId,
    updatedAt: Date.now(),
  });

  if (config) {
    const components = renderSignupComponents(newBoard, config);
    await message.edit({ components });
  } else {
    await message.react(LETTER_EMOJIS.D);
    await message.react(LETTER_EMOJIS.C);
    await message.react(LETTER_EMOJIS.B);
    await message.react(LETTER_EMOJIS.A);
  }

  return { board: newBoard, message };
}

async function updateMessageEmbed(message, boardId = null) {
  const guildId = message.guild.id;
  const board = boardId ? await getBoardByDocId(boardId) : await getBoardByMessage(guildId, message.id);

  if (!board) return;

  let config = null;
  if (board.configId) {
    config = await getSignupConfig(board.configId);
  }

  const embed = renderSignupEmbed(board, message.guild, config);
  await message.edit({ embeds: [embed] });
}

// Handler for legacy reactions
async function handleReactionAdd(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const guildId = reaction.message.guild?.id;
  if (!guildId) return;

  const board = await getBoardByMessage(guildId, reaction.message.id);
  if (!board) return;

  // Only handle legacy boards via reactions. Configured boards use buttons.
  if (board.configId) return;

  const letter = normalizeEmojiName(reaction.emoji.name);
  if (!letter) return;

  board.signups = board.signups || {};
  // Legacy logic: single choice
  for (const k of ["A", "B", "C", "D"]) {
    board.signups[k] = (board.signups[k] || []).filter((id) => id !== user.id);
  }

  const list = new Set(board.signups[letter] || []);
  list.add(user.id);
  board.signups[letter] = Array.from(list);
  board.updatedAt = Date.now();

  await saveBoard(board);
  await updateMessageEmbed(reaction.message);
}

async function handleReactionRemove(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  const guildId = reaction.message.guild?.id;
  if (!guildId) return;

  const board = await getBoardByMessage(guildId, reaction.message.id);
  if (!board) return;
  if (board.configId) return; // Only legacy

  const letter = normalizeEmojiName(reaction.emoji.name);
  if (!letter) return;

  board.signups = board.signups || {};
  board.signups[letter] = (board.signups[letter] || []).filter((id) => id !== user.id);
  board.updatedAt = Date.now();

  await saveBoard(board);
  await updateMessageEmbed(reaction.message);
}

// Handler for new button interactions
async function handleSignupButton(interaction) {
  try {
    const parts = interaction.customId.split("_");
    // customId format: signup_<boardId>_<value>
    // boardId might contain underscores if we didn't use UUIDs properly, but getSignupDocId uses guildId_msgId
    // guildId is snowflake (no _), msgId is snowflake (no _).
    // So boardId = "guildId_msgId". 
    // parts[0] = "signup"
    // parts[1] = guildId
    // parts[2] = msgId
    // parts[3+] = value (value might contain underscores if users are weird, so we join the rest)

    // Let's reconstruct boardId from parts[1] and parts[2]
    const boardId = `${parts[1]}_${parts[2]}`;
    const value = parts.slice(3).join("_");

    const board = await getBoardByDocId(boardId);
    if (!board) {
      return interaction.reply({ content: "❌ Board not found or expired.", ephemeral: true });
    }

    const config = await getSignupConfig(board.configId);
    if (!config) {
      return interaction.reply({ content: "❌ Configuration for this board is missing.", ephemeral: true });
    }

    // Check roles
    const member = await interaction.guild.members.fetch(interaction.user.id);

    // 1. Global Requirement
    if (config.requiredRole && !member.roles.cache.has(config.requiredRole)) {
      const role = interaction.guild.roles.cache.get(config.requiredRole);
      const roleName = role ? role.name : "a required role";
      return interaction.reply({
        content: `❌ You need the **${roleName}** role to sign up for this board.`,
        ephemeral: true
      });
    }

    // 2. Option Requirement
    const option = categoryOptions(config).find(o => o.value === value);
    if (option && option.roleId && !member.roles.cache.has(option.roleId)) {
      const role = interaction.guild.roles.cache.get(option.roleId);
      const roleName = role ? role.name : "required role";
      return interaction.reply({
        content: `❌ You need the **${roleName}** role to select **${option.label}**.`,
        ephemeral: true
      });
    }

    // Proceed with signup logic
    board.signups = board.signups || {};
    const userId = interaction.user.id;

    // Check if already signed up for this option
    const currentList = board.signups[value] || [];
    const isSignedUp = currentList.includes(userId);

    if (isSignedUp) {
      // Remove
      board.signups[value] = currentList.filter(id => id !== userId);
      await saveBoard(board);
      await updateMessageEmbed(interaction.message, boardId);
      return interaction.reply({ content: `✅ Removed from **${option ? option.label : value}**.`, ephemeral: true });
    } else {
      // Add
      // Check multiple choice constraint
      if (!config.allowMultiple) {
        // Remove from all other options first
        for (const key of Object.keys(board.signups)) {
          board.signups[key] = (board.signups[key] || []).filter(id => id !== userId);
        }
      }

      board.signups[value] = board.signups[value] || [];
      board.signups[value].push(userId);

      await saveBoard(board);
      await updateMessageEmbed(interaction.message, boardId);
      return interaction.reply({ content: `✅ Signed up for **${option ? option.label : value}**!`, ephemeral: true });
    }

  } catch (error) {
    console.error("Error handling signup button:", error);
    if (!interaction.replied) {
      interaction.reply({ content: "⚠️ Error processing signup.", ephemeral: true });
    }
  }
}

module.exports = {
  LETTER_EMOJIS,
  postSignupBoard,
  repostSignupBoard,
  handleReactionAdd,
  handleReactionRemove,
  handleSignupButton
};
