// DOM lookup. `elements` is populated once at DOMContentLoaded by initElements();
// every module reads its elements from here.
export const $ = (id) => document.getElementById(id);

export const elements = {};

export function initElements()
{
  Object.assign(elements, {
    startupLoading: $("startupLoading"),
    homeLinkBtn: $("homeLinkBtn"),
    menuPage: $("menuPage"),
    scoreboardPage: $("scoreboardPage"),

    scoreboard: document.querySelector(".scoreboard"),

    points: {
      A: $("pointsA"),
      B: $("pointsB")
    },

    sets: {
      A: $("setsA"),
      B: $("setsB")
    },

    games: {
      A: $("gamesA"),
      B: $("gamesB")
    },

    critical: {
      A: $("criticalA"),
      B: $("criticalB")
    },

    cooldown: $("cooldown"),
    controls: $("controls"),
    resetModal: $("resetModal"),

    confirmResetBtn: $("confirmReset"),
    shallowResetBtn: $("shallowReset"),
    cancelResetBtn: $("cancelReset"),

    undoBtn: $("undoBtn"),
    backBtn: $("backBtn"),
    swapBtn: $("swapBtn"),
    changeoverBtn: $("changeoverBtn"),
    changeoverTile: $("changeoverTile"),
    muteBtn: $("muteBtn"),
    fullscreenBtn: $("fullscreenBtn"),
    fullscreenLabel: $("fullscreenLabel"),

    appearanceMenuBtn: $("appearanceMenuBtn"),
    appearanceMenu: $("appearanceMenu"),
    waveToggleScoreboardBtn: $("waveToggleScoreboardBtn"),
    waveToggleSpectateBtn: $("waveToggleSpectateBtn"),

    activateNfcBtn: $("activateNfcBtn"),

    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    closeSettingsBtn: $("closeSettingsBtn"),
    playerNamesModal: $("playerNamesModal"),
    closePlayerNamesBtn: $("closePlayerNamesBtn"),
    playerNamesForm: $("playerNamesForm"),
    cancelPlayerNamesBtn: $("cancelPlayerNamesBtn"),
    playerTeamAName: $("playerTeamAName"),
    playerTeamBName: $("playerTeamBName"),
    playerNameA1: $("playerNameA1"),
    playerNameA2: $("playerNameA2"),
    playerNameB1: $("playerNameB1"),
    playerNameB2: $("playerNameB2"),
    scoringModeSelect: $("scoringModeSelect"),
    deuceModeSelect: $("deuceModeSelect"),
    tiebreakModeSelect: $("tiebreakModeSelect"),
    scoringStatus: $("scoringStatus"),
    scoreFormatBadge: $("scoreFormatBadge"),
    straightPointsTotal: $("straightPointsTotal"),
    straightTotalValue: $("straightTotalValue"),
    serverBadgeA: $("serverBadgeA"),
    serverBadgeB: $("serverBadgeB"),

    serverToggleBtn: $("serverToggleBtn"),
    serverToggleTile: $("serverToggleTile"),
    editPlayersBtn: $("editPlayersBtn"),
    editPlayersTile: $("editPlayersTile"),
    resetSettingsBtn: $("resetSettingsBtn"),
    resetSettingsTile: $("resetSettingsTile"),
    obsOverlayBtn: $("obsOverlayBtn"),
    joinCourtBtn: $("joinCourtBtn"),
    joinCourtTile: $("joinCourtTile"),
    switchToSpectateBtn: $("switchToSpectateBtn"),
    switchToSpectateTile: $("switchToSpectateTile"),

    sep1: $("sep1"),
    sep2: $("sep2"),
    sep3: $("sep3"),

    detailsBtn: $("detailsBtn"),
    detailsModal: $("detailsModal"),
    closeDetailsBtn: $("closeDetailsBtn"),
    shareDetailsBtn: $("shareDetailsBtn"),
    shareCourtBtn: $("shareCourtBtn"),
    matchDetailsCourtName: $("matchDetailsCourtName"),
    detailsSetsA: $("detailsSetsA"),
    detailsSetsB: $("detailsSetsB"),
    detailsTeamAName: $("detailsTeamAName"),
    detailsTeamBName: $("detailsTeamBName"),
    dmHead: $("dmHead"),
    dmBody: $("dmBody"),
    detailsLoading: $("detailsLoading"),
    dmMomentumWrap: $("dmMomentumWrap"),
    dmMomentumCanvas: $("dmMomentumCanvas"),
    dmDetailsPanel: $("dmDetailsPanel"),
    dmDetailsToggle: $("dmDetailsToggle"),
    dmDetailsContent: $("dmDetailsContent"),
    dmEmptyState: $("dmEmptyState"),
    dmErrorState: $("dmErrorState"),
    dmStatsWrap: $("dmStatsWrap"),
    dmStatsTeam: $("dmStatsTeam"),
    courtQrPanel: $("courtQrPanel"),
    courtQrCode: $("courtQrCode"),
    courtQrLabel: $("courtQrLabel"),

    confirmModal: $("confirmModal"),
    confirmMessage: $("confirmMessage"),
    confirmOkBtn: $("confirmOkBtn"),
    confirmCancelBtn: $("confirmCancelBtn"),

    setWinOverlay: $("setWinOverlay"),
    scoreboardLoading: $("scoreboardLoading"),
  });

  //CREATE COURT ELEMENTS
  elements.createPage = $("createPage");
  elements.closeCreateBtn = $("closeCreateBtn");
  elements.createCourtBtn = $("createCourtBtn");

  elements.adminPassword = $("adminPassword");
  elements.courtName = $("courtName");
  elements.courtPassword = $("courtPassword");

  elements.adminError = $("adminError");
  elements.courtNameError = $("courtNameError");
  elements.courtPasswordError = $("courtPasswordError");
  elements.courtStatus = $("courtStatus");
  elements.courtScoringMode = $("courtScoringMode");
  elements.courtDeuceMode = $("courtDeuceMode");
  elements.courtTiebreakMode = $("courtTiebreakMode");

  // ADMIN AUTH ELEMENTS
  elements.adminLoginBtn = $("adminLoginBtn");
  elements.adminAuthPage = $("adminAuthPage");
  elements.adminAuthPassword = $("adminAuthPassword");
  elements.submitAdminAuthBtn = $("submitAdminAuthBtn");
  elements.adminAuthError = $("adminAuthError");
  elements.closeAdminAuthBtn = $("closeAdminAuthBtn");

  // ADMIN DASHBOARD ELEMENTS
  elements.adminDashboardPage = $("adminDashboardPage");
  elements.adminCourtList = $("adminCourtList");
  elements.closeAdminDashboardBtn = $("closeAdminDashboardBtn");
  elements.showCreateCourtModalBtn = $("showCreateCourtModalBtn");
  elements.adminCourtSearch = $("adminCourtSearch");
  elements.adminStatusFilter = $("adminStatusFilter");
  elements.nfcToolBtn = $("nfcToolBtn");

  // EDIT COURT ELEMENTS
  elements.editCourtPage = $("editCourtPage");
  elements.editCourtNameTitle = $("editCourtNameTitle");
  elements.editCourtName = $("editCourtName");
  elements.editTeamAName = $("editTeamAName");
  elements.editTeamBName = $("editTeamBName");
  elements.editPlayerA1Name = $("editPlayerA1Name");
  elements.editPlayerA2Name = $("editPlayerA2Name");
  elements.editPlayerB1Name = $("editPlayerB1Name");
  elements.editPlayerB2Name = $("editPlayerB2Name");
  elements.editCourtPassword = $("editCourtPassword");
  elements.editCourtStatus = $("editCourtStatus");
  elements.editCourtScoringMode = $("editCourtScoringMode");
  elements.editCourtDeuceMode = $("editCourtDeuceMode");
  elements.editCourtTiebreakMode = $("editCourtTiebreakMode");
  elements.clearCourtScoreBtn = $("clearCourtScoreBtn");
  elements.saveEditBtn = $("saveEditBtn");
  elements.deleteCourtBtn = $("deleteCourtBtn");
  elements.closeEditBtn = $("closeEditBtn");

  //PLAY COURT ELEMENTS
  elements.playPage = $("playPage");
  elements.closePlayBtn = $("closePlayBtn");

  elements.playCourtSearch = $("playCourtSearch");
  elements.playCourtList = $("playCourtList");
  elements.playPasswordSection = $("playPasswordSection");
  elements.playCourtPassword = $("playCourtPassword");
  elements.playCourtNameError = $("playCourtNameError");
  elements.playCourtPasswordError = $("playCourtPasswordError");
  elements.playBackBtn = $("playBackBtn");

  elements.enterCourtBtn = $("enterCourtBtn");

  //SPECTATE COURT ELEMENTS
  elements.spectatePage = $("spectatePage");
  elements.closeSpectateBtn = $("closeSpectateBtn");

  elements.spectateCourtSearch = $("spectateCourtSearch");
  elements.spectateCourtList = $("spectateCourtList");
  elements.spectateCourtNameError = $("spectateCourtNameError");

  //RESET COURT ELEMENTS
  elements.resetCourtPassword = $("resetCourtPassword");
  elements.resetPasswordError = $("resetPasswordError");

  //NFC ELEMENTS
  elements.nfcCooldownBanner = $("nfcCooldownBanner");
  elements.nfcCountdown = $("nfcCountdown");

  //Admin portal things
  elements.adminTabs = document.querySelectorAll('.tab-btn');
  elements.courtsTab = $("courtsTab");
  elements.devicesTab = $("devicesTab");
  elements.adminDeviceList = $("adminDeviceList");
  elements.adminDeviceSearch = $("adminDeviceSearch");

  // Add/Edit Device Modal Elements
  elements.addDevicePage = $("addDevicePage");
  elements.showAddDeviceModalBtn = $("showAddDeviceModalBtn");
  elements.closeAddDeviceBtn = $("closeAddDeviceBtn");
  elements.saveNewDeviceBtn = $("saveNewDeviceBtn");
  elements.newDeviceId = $("newDeviceId");
  // Combo elements — Add Device
  elements.newDeviceCourtIdSelect = $("newDeviceCourtIdSelect");
  elements.newDeviceCourtIdManual = $("newDeviceCourtIdManual");
  elements.newDeviceManualToggle = $("newDeviceManualToggle");
  elements.newDeviceDropdownToggle = $("newDeviceDropdownToggle");
  elements.newDeviceDropdownToggleRow = $("newDeviceDropdownToggleRow");

  elements.editDevicePage = $("editDevicePage");
  elements.editDeviceIdTitle = $("editDeviceIdTitle");
  // Combo elements — Edit Device
  elements.editDeviceCourtIdSelect = $("editDeviceCourtIdSelect");
  elements.editDeviceCourtIdManual = $("editDeviceCourtIdManual");
  elements.editDeviceManualToggle = $("editDeviceManualToggle");
  elements.editDeviceDropdownToggle = $("editDeviceDropdownToggle");
  elements.editDeviceDropdownToggleRow = $("editDeviceDropdownToggleRow");
  elements.saveEditDeviceBtn = $("saveEditDeviceBtn");
  elements.deleteDeviceBtn = $("deleteDeviceBtn");
  elements.closeEditDeviceBtn = $("closeEditDeviceBtn");
}
