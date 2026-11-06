const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("streaming_add")
    .setDescription("Tilmeld dine streamingkanaler, og få DZR-script og nøgle til OBS")
    // Everyone can invoke; streamingHandlers checks Club Member at execution.
    .setDefaultMemberPermissions(null)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("streaming_remove")
    .setDescription("Afmeld din streaming, og spær din OBS-nøgle")
    .setDefaultMemberPermissions(null)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("streaming_overview")
    .setDescription("Se tilmeldte streamere og deres seneste livestreams (admin)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addIntegerOption(option => option.setName("page").setDescription("Side i oversigten").setMinValue(1)),
  // refresh_club_roster (admin only)
  new SlashCommandBuilder()
    .setName("refresh_club_roster")
    .setDescription("Refresh Zwift club roster and store it in Firestore (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // refresh_zwiftpower_roster (admin only)
  new SlashCommandBuilder()
    .setName("refresh_zwiftpower_roster")
    .setDescription("Refresh ZwiftPower club roster and store it in Firestore (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // sync_zp_roles (admin only)
  new SlashCommandBuilder()
    .setName("sync_zp_roles")
    .setDescription("Run ZwiftPower pace-group role assignment now (add-only, admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // rider_stats
  new SlashCommandBuilder()
    .setName("rider_stats")
    .setDescription("Fetch single-rider stats by ZwiftID or Discord user mention")
    .addStringOption(option =>
      option
        .setName("zwiftid")
        .setDescription("The Zwift ID to check")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("discorduser")
        .setDescription("Mention a Discord user to fetch their linked ZwiftID")
        .setRequired(false)
    ),
  // my_zwiftid (self-linking; direct or search-based)
  new SlashCommandBuilder()
    .setName("my_zwiftid")
    .setDescription("Link your Discord ID to a ZwiftID (direct or via search)")
    .addStringOption(option =>
      option
        .setName("zwiftid")
        .setDescription("Your Zwift ID")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("searchterm")
        .setDescription("Your name as on Zwift/ZwiftPower (4+ letters searches all of ZwiftPower)")
        .setRequired(false)
    ),
  // whoami
  new SlashCommandBuilder()
    .setName("whoami")
    .setDescription("Retrieve your linked ZwiftID"),
  // coach (club members only; continues in DM)
  new SlashCommandBuilder()
    .setName("coach")
    .setDescription("Open a private DZR Coach DM (club members only)"),
  // team_stats
  new SlashCommandBuilder()
    .setName("team_stats")
    .setDescription("Compare multiple riders' stats from today's club_stats data")
    .addUserOption(option =>
      option
        .setName("rider1")
        .setDescription("First Discord user to compare")
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName("rider2")
        .setDescription("Second Discord user")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("rider3")
        .setDescription("Third Discord user")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("rider4")
        .setDescription("Fourth Discord user")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("rider5")
        .setDescription("Fifth Discord user")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("rider6")
        .setDescription("Sixth Discord user")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("rider7")
        .setDescription("Seventh Discord user")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("rider8")
        .setDescription("Eighth Discord user")
        .setRequired(false)
    ),
  // browse_riders
  new SlashCommandBuilder()
    .setName("browse_riders")
    .setDescription("Browse riders in today's club_stats by first 3 letters")
    .addStringOption(option =>
      option
        .setName("searchterm")
        .setDescription("First 3+ letters of the rider's name")
        .setRequired(true)
    ),
  // set_zwiftid (for setting another user's linked ZwiftID)
  new SlashCommandBuilder()
    .setName("set_zwiftid")
    .setDescription("Set the ZwiftID for a specified Discord user (direct or via search)")
    .addUserOption(option =>
      option
        .setName("discorduser")
        .setDescription("The Discord user to update")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("zwiftid")
        .setDescription("The ZwiftID to set")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("searchterm")
        .setDescription("First 3+ letters to search for the rider")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
  // get_zwiftid (for retrieving a user's linked ZwiftID)
  new SlashCommandBuilder()
    .setName("get_zwiftid")
    .setDescription("Get the linked ZwiftID for a specified Discord user")
    .addUserOption(option =>
      option
        .setName("discorduser")
        .setDescription("The Discord user to query")
        .setRequired(true)
    ),
  // event_results
  new SlashCommandBuilder()
    .setName("event_results")
    .setDescription("Get team results from events matching a search string")
    .addStringOption(option =>
      option
        .setName("search")
        .setDescription("Search string to match in event titles")
        .setRequired(true)
    ),
  // new_members
  new SlashCommandBuilder()
    .setName("new_members")
    .setDescription("Mention members who joined within N days and have a role")
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Only include members who currently have this role")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("within_days")
        .setDescription("Number of days back to include (default: 7)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  // onboarding_preview (admin only)
  new SlashCommandBuilder()
    .setName("onboarding_preview")
    .setDescription("Send yourself the onboarding DM for a simulated member status (admin only)")
    .addStringOption(option =>
      option
        .setName("as_status")
        .setDescription("The member status to simulate")
        .setRequired(true)
        .addChoices(
          { name: "Just joined", value: "join" },
          { name: "Member, no Zwift ID, not paid", value: "fresh_unpaid" },
          { name: "Paid on /join, no Zwift ID yet", value: "paid_no_zwift" },
          { name: "Verified, not paid", value: "verified_not_paid" },
          { name: "Verified, role and payment disagree", value: "paid_role_pending" },
          { name: "Club member, intervals.icu not connected", value: "club_no_intervals" },
          { name: "Everything done", value: "done" }
        )
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  // onboarding_reset (admin only)
  new SlashCommandBuilder()
    .setName("onboarding_reset")
    .setDescription("Forget which onboarding DMs a user got, and mark them as test (admin only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The (test) user to reset")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  // Announcer (admin only)
  new SlashCommandBuilder()
    .setName("announcer_run")
    .setDescription("Show what the announcer would post about now; optionally draft it (admin only)")
    .addBooleanOption(option =>
      option
        .setName("draft")
        .setDescription("Write a draft for moderators now instead of only showing the candidates")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder()
    .setName("announcer_pause")
    .setDescription("Pause or resume bot-written announcements (admin only)")
    .addBooleanOption(option =>
      option
        .setName("paused")
        .setDescription("True to pause, false to resume")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder()
    .setName("announcer_stats")
    .setDescription("Bot DMs per step (sent, closed, engaged, converted, silent) and recent announcements (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder()
    .setName("announcer_preview_dm")
    .setDescription("Send yourself a DM reminder as members get it (admin only)")
    .addStringOption(option =>
      option
        .setName("step")
        .setDescription("The reminder to preview")
        .setRequired(true)
        .addChoices(
          { name: "Link Zwift ID (not paid)", value: "link_zwift_id_channel" },
          { name: "Link Zwift ID (paid on /join)", value: "link_zwift_id_join" },
          { name: "Connect intervals.icu for DZR Coach", value: "connect_intervals" },
          { name: "Join DZR in Zwift Companion", value: "join_companion" }
        )
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // Legacy self-role management commands (for backward compatibility)
  new SlashCommandBuilder()
    .setName("setup_roles")
    .setDescription("Setup the default role system for this server (admin only)")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where the role selection panel will be posted")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("add_selfrole")
    .setDescription("Add a role to the default role panel (admin only)")
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to add to self-selection")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Description for this role (optional)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("emoji")
        .setDescription("Emoji for this role (optional)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("remove_selfrole")
    .setDescription("Remove a role from the default role panel (admin only)")
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to remove from self-selection")
        .setRequired(true)
    ),

  // Verification system commands
  new SlashCommandBuilder()
    .setName("setup_verification")
    .setDescription("Setup auto-role verification system (admin only)")
    .addRoleOption(option =>
      option
        .setName("verified_role")
        .setDescription("The role to assign to verified members")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName("require_zwiftid")
        .setDescription("Require users to have a linked ZwiftID")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("minimum_account_age_days")
        .setDescription("Minimum Discord account age in days")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(365)
    )
    .addBooleanOption(option =>
      option
        .setName("require_server_boost")
        .setDescription("Require users to be server boosters")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("verification_status")
    .setDescription("Check verification status for yourself or another user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to check verification status for (optional)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("process_verification")
    .setDescription("Manually process verification for all server members (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("disable_verification")
    .setDescription("Disable the auto-verification system (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // Team signup board commands
  new SlashCommandBuilder()
    .setName("post_signup_board")
    .setDescription("Post a signup board in a channel (admin only)")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to post the signup board (defaults to current)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("config_id")
        .setDescription("Search for a board by title (or paste ID)")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("repost_signup_board")
    .setDescription("Repost a signup board for this channel with current signups (admin only)")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to repost the signup board (defaults to current)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("config_id")
        .setDescription("Optional: Choose a specific board template to repost")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("roles_panel")
    .setDescription("Create/update the default role selection panel (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // NEW: Multi-panel role management commands
  new SlashCommandBuilder()
    .setName("setup_panel")
    .setDescription("Setup a role panel for a specific channel (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Unique ID for this panel (e.g., 'basic', 'advanced', 'vip')")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where this panel will be posted")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Display name for this panel")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Description for this panel")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("required_role")
        .setDescription("Role required to access this panel (optional)")
        .setRequired(false)
    )
    .addChannelOption(option =>
      option
        .setName("approval_channel")
        .setDescription("Channel for approval requests from this panel (optional)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("add_panel_role")
    .setDescription("Add a role to a specific panel (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID to add the role to")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to add")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Description for this role")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("emoji")
        .setDescription("Emoji for this role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("required_role_1")
        .setDescription("First role required to get this role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("required_role_2")
        .setDescription("Second role required to get this role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("required_role_3")
        .setDescription("Third role required to get this role")
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName("requires_approval")
        .setDescription("Whether this role requires approval before being granted")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("team_captain")
        .setDescription("Team captain who can approve this role (if approval required)")
        .setRequired(false)
    )
    .addChannelOption(option =>
      option
        .setName("approval_channel")
        .setDescription("Specific channel for this role's approval requests (optional)")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("button_color")
        .setDescription("Button color in Discord (Default: Gray)")
        .setRequired(false)
        .addChoices(
          { name: 'Gray (Secondary)', value: 'Secondary' },
          { name: 'Blue (Primary)', value: 'Primary' },
          { name: 'Green (Success)', value: 'Success' },
          { name: 'Red (Danger)', value: 'Danger' }
        )
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("remove_panel_role")
    .setDescription("Remove a role from a specific panel (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID to remove the role from")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to remove")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("update_panel")
    .setDescription("Update/refresh a specific role panel (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID to update")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("list_panels")
    .setDescription("List all role panels in this server (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("set_role_approval")
    .setDescription("Set approval requirement for a role in a panel (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID containing the role")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to modify")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName("requires_approval")
        .setDescription("Whether this role requires approval")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("pending_approvals")
    .setDescription("View pending role approval requests (admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

  new SlashCommandBuilder()
    .setName("set_team_captain")
    .setDescription("Set or update the team captain for a role (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID containing the role")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The team role to assign a captain to")
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName("team_captain")
        .setDescription("The user who will be the team captain")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("set_panel_approval_channel")
    .setDescription("Set the approval channel for a specific panel (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID to set approval channel for")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addChannelOption(option =>
      option
        .setName("approval_channel")
        .setDescription("Channel for approval requests from this panel")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("set_role_approval_channel")
    .setDescription("Set the approval channel for a specific role (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID containing the role")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to set approval channel for")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("approval_channel")
        .setDescription("Channel for this role's approval requests")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("set_role_prerequisites")
    .setDescription("Set role prerequisites for a specific role (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID containing the role")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to set prerequisites for")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName("required_role_1")
        .setDescription("First role required to get this role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("required_role_2")
        .setDescription("Second role required to get this role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("required_role_3")
        .setDescription("Third role required to get this role")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("set_role_button_color")
    .setDescription("Set the button color for a specific role (admin only)")
    .addStringOption(option =>
      option
        .setName("panel_id")
        .setDescription("Panel ID containing the role")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role to set button color for")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("button_color")
        .setDescription("Button color in Discord")
        .setRequired(true)
        .addChoices(
          { name: 'Gray (Secondary)', value: 'Secondary' },
          { name: 'Blue (Primary)', value: 'Primary' },
          { name: 'Green (Success)', value: 'Success' },
          { name: 'Red (Danger)', value: 'Danger' }
        )
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("roles_help")
    .setDescription("Advanced role system guide and setup help"),

  // NEW: Team Captain Management Commands
  new SlashCommandBuilder()
    .setName("my_team")
    .setDescription("View and manage your team members (team captains only)")
    .addRoleOption(option =>
      option
        .setName("team_role")
        .setDescription("Specific team to view (leave empty to see all your teams)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("remove_team_member")
    .setDescription("Remove a member from your team (team captains only)")
    .addRoleOption(option =>
      option
        .setName("team_role")
        .setDescription("The team role to remove the member from")
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName("member")
        .setDescription("The team member to remove")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Optional reason for removal")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("add_team_member")
    .setDescription("Add a member to your team (team captains only)")
    .addRoleOption(option =>
      option
        .setName("team_role")
        .setDescription("The team role to add the member to")
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName("member")
        .setDescription("The Discord user to add")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Optional note for the member")
        .setRequired(false)
    ),

  // Zwift route quiz (ZwiftQuiz-style)
  new SlashCommandBuilder()
    .setName("quiz")
    .setDescription("Post a Zwift route quiz — guess the route from the map shape"),
  // Ladder match previews (team list is stored in Firestore collection ladder_bot)
  new SlashCommandBuilder()
    .setName("ladder_link")
    .setDescription("Add or remove a ladder team that gets previews and match-day reminders")
    .addStringOption(option =>
      option
        .setName("team")
        .setDescription("Team name or a link to the team on ladder.cycleracing.club")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName("remove")
        .setDescription("Remove the team instead of adding it")
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("minutes")
        .setDescription("Minutes before start the preview is posted (default 65)")
        .setMinValue(5)
        .setMaxValue(1440)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ladder_preview")
    .setDescription("Post a ladder match preview now (image with route, powerups and riders)")
    .addStringOption(option =>
      option
        .setName("team")
        .setDescription("Team name or link (default: the only added team)")
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("match")
        .setDescription("Ladder match id (default: the team's next match)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ladder_analysis")
    .setDescription("Rule-based strength comparison and tactics for a ladder match")
    .addStringOption(option =>
      option
        .setName("team")
        .setDescription("Team name or link (default: the only added team)")
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("match")
        .setDescription("Ladder match id (default: the team's next match)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ladder_ai")
    .setDescription("AI analysis of how to ride a ladder match (limited uses per day)")
    .addStringOption(option =>
      option
        .setName("team")
        .setDescription("Team name or link (default: this channel's team)")
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("match")
        .setDescription("Ladder match id (default: the team's next match)")
        .setRequired(false)
    ),
].map(cmd => cmd.toJSON());

module.exports = commands;
