const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
//const steamworks = require('steamworks.js'); // Added steamworks.js import

// Log Electron executable path for debugging DLL placement and steamworks.js loading
console.log('Electron executable path:', process.execPath);
console.log('Current working directory:', process.cwd());
console.log('System PATH:', process.env.PATH);

// Load steamworkswinx64-withlogs 
let steamworks;
let steamClient; //start change -- declare steamClient globally to use in IPC handler//
try {
  steamworks = require('steamworkswinx64-withlogs');
  console.log('steamworkswinx64-withlogs module loaded successfully');
} catch (error) {
  console.error('Failed to load steamworkswinx64-withlogs module:', error);
}

//FIXING INDEX.JS LAST ISSUES start: Declare currentLobby to track Lobby object
let currentLobby = null;
//FIXING INDEX.JS LAST ISSUES finish


function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    resizable: true,
    fullscreenable: true,
    fullscreen: false, // Ensure window starts non-fullscreen
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Initialize steamworkswinx64-withlogs with App ID
  if (steamworks) {
    try {
      console.log('Attempting Steamworks initialization with AppId: 3977960');
      steamClient = steamworks.init(3977960); // Modified to assign to global steamClient
      console.log('Steamworks initialized successfully. User:', steamClient.localplayer.getName());
      console.log("steamClient object:", JSON.stringify(Object.keys(steamClient), null, 2));
      console.log(
        "steamClient.networking object:",
        JSON.stringify(Object.keys(steamClient.networking), null, 2)
      );
      // ACHIEVEMENT when play the game first time
      const achievementId = 'ACH_FIRST_RUN'; // Must match Steamworks API Name
      steamClient.achievement.activate(achievementId);
      console.log(`Activated achievement: ${achievementId}`);
      setTimeout(() => {
        const isAchieved = steamClient.achievement.isActivated(achievementId);
        console.log(`Achievement ${achievementId} status: ${isAchieved ? 'Unlocked' : 'Locked'}`);
      }, 2000);

      // Register Steamworks callbacks for multiplayer using callback.register
      if (steamClient.callback && typeof steamClient.callback.register === "function") {
        // Handle lobby join (using LobbyChatUpdate as a proxy for lobby join/player joined events)
        steamClient.callback.register(5, (data) => {
          // LobbyChatUpdate provides lobby_id, user_changed, state, change_type
        //START BETA CHANGE 7 -- use actual field names + robust fallbacks --
         const lobbyId = (data && (data.lobby ?? data.lobby_id)); // BigInt
         const steamId = (data && (data.user_changed ?? data.userChanged)); // BigInt
         const stateStr = (data && (data.member_state_change ?? data.change_type)); // "Entered" | "Left" | ...
         const changeType = stateStr === 'Entered' ? 1 : (stateStr === 'Left' ? 2 : undefined);

         // local steam id: prefer camelCase .steamId64, fallback to snake_case if ever present
         const localSteamObj = steamClient.localplayer.getSteamId();
         const localSteamId = (localSteamObj && (localSteamObj.steamId64 ?? localSteamObj.steam_id64));

         // raw dumps (kept from BETA 6)
         try {
           const keys = data ? Object.keys(data) : [];
           console.log('[LobbyChatUpdate RAW] typeof data =', typeof data, 'keys =', keys);
           for (const k of keys) {
             const v = data[k];
             console.log(`  [RAW] ${k}: typeof=${typeof v} value=${typeof v === 'bigint' ? String(v) : String(v)}`);
           }
         } catch (e) {
           console.warn('[LobbyChatUpdate RAW] Failed to introspect event payload:', e);
         }
         try {
           console.log('[LocalSteamId RAW]', localSteamObj);
           console.log('[LocalSteamId RAW string]', String(localSteamId));
         } catch (e) {
           console.warn('[LocalSteamId RAW] Failed to read local steam id:', e);
         }

         const lobbyIdStr = lobbyId !== undefined ? String(lobbyId) : 'undefined';
         const userIdStr  = steamId !== undefined ? String(steamId) : 'undefined';
         const currentLobbyIdStr = currentLobby ? String(currentLobby.id) : 'null';
         console.log(`[LobbyChatUpdate] lobby=${lobbyIdStr} userChanged=${userIdStr} changeType=${changeType} local=${localSteamId} currentLobby=${currentLobbyIdStr}`);

         if (changeType === 1) { // joined
           const isSelf = String(steamId) === String(localSteamId);
           if (isSelf) {
             // Confirm our own join (useful on client after joinLobby)
            if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) { //START ALPHA CHANGE 109
               win.webContents.send("lobby-joined", lobbyId, true);
             } else {
               console.warn('[Lobby] No alive webContents for lobby-joined');
             } //FINISH ALPHA CHANGE 109
             console.log(`[Lobby] Local player confirmed joined lobby ${lobbyIdStr}`);
           } else if (currentLobby && String(currentLobby.id) === lobbyIdStr) { 
             // Only emit for the *other* player joining *our* current lobby
             if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) { //START ALPHA CHANGE 110
               win.webContents.send("lobby-player-joined", steamId);
             } else {
               console.warn('[Lobby] No alive webContents for lobby-player-joined');
             } //FINISH ALPHA CHANGE 110
             console.log(`[Lobby] Remote player joined lobby ${lobbyIdStr}: ${userIdStr}`);
             try {
               const count = currentLobby.getMemberCount();
               console.log(`[Lobby] Member count now: ${count}`);
             } catch (e) {
               console.warn('[Lobby] Could not read member count:', e);
             }
           } else {
             console.log(`[Lobby] Ignoring join for non-current lobby ${lobbyIdStr}`);
           }
         } else if (changeType === 2) {
           console.log(`[Lobby] Player left lobby ${lobbyIdStr}: ${userIdStr}`);
        //START ALPHA CHANGE 90 -- emit IPC so renderer can teardown when the *other* member leaves
           try {
            if (currentLobby && String(currentLobby.id) === lobbyIdStr) {
              const isSelf = String(steamId) === String(localSteamId);
              if (!isSelf && win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('lobby-player-left', { lobbyId, steamId });
                console.log(`[Lobby] Emitted lobby-player-left for lobby ${lobbyIdStr}, leaver ${userIdStr}`);
              }
            }
          } catch (e) {
            console.warn('[Lobby] Failed to emit lobby-player-left:', e);
          }
        //FINISH ALPHA CHANGE 90 -- emit IPC so renderer can teardown when the *other* member leaves
        }
        //FINISH BETA CHANGE 7 -- use actual field names + robust fallbacks --
        });

        // Handle P2P messages
        steamClient.callback.register(6, (data) => {
          //START BETA CHANGE 13 -- robustly accept P2P session without crashing + log payload shape --
          try {
            const keys = data ? Object.keys(data) : [];
            console.log('[P2PSessionRequest RAW] typeof data =', typeof data, 'keys =', keys);
            // Try common field names used by bindings (snake/camel variants)
            const remote = data && (
              data.remote ??
              data.steam_id_remote ??
              data.remote_steam_id ??
              data.remoteId ??
              data.steamIdRemote
            );
            if (remote === undefined) {
              console.warn('[P2PSessionRequest] Missing remote steam id in payload:', data);
              return;
            }
            const remoteBig = (typeof remote === 'bigint') ? remote : BigInt(remote);
            steamClient.networking.acceptP2PSession(remoteBig);
            console.log(`[P2PSessionRequest] Accepted P2P session from SteamID: ${String(remoteBig)}`);
          } catch (err) {
            console.error('[P2PSessionRequest] Failed to accept P2P session:', err);
          }
          //FINISH BETA CHANGE 13 -- robustly accept P2P session without crashing + log payload shape --
        });

        // Poll for P2P packets (since networking.on is not available)
        const pollP2PPackets = () => {
         //START BETA CHANGE 23 -- drain all queued packets per tick + guard window + lower latency --
          try {
            let packetSize = steamClient.networking.isP2PPacketAvailable();
            while (packetSize > 0) {
              try {
                const packet = steamClient.networking.readP2PPacket(packetSize);
 
                // Reuse sender extraction (BETA 14)
                const senderObj = packet && (packet.steam_id ?? packet.steamId);
                const senderRaw = senderObj && (senderObj.steamId64 ?? senderObj.steam_id64 ?? senderObj);
                const sender = typeof senderRaw === 'bigint' ? senderRaw : (senderRaw !== undefined ? BigInt(senderRaw) : undefined);
 
                if (sender === undefined) {
                  console.warn('[P2P] Packet missing sender steam id. Raw packet keys:', Object.keys(packet || {}));
                } else if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                  // BINARY-ONLY: forward raw Buffer
                  // START BETA CHANGE 36 -- coerce to Buffer before IPC to guarantee binary-safe, fast path
                  const buf = Buffer.isBuffer(packet.data) ? packet.data : Buffer.from(packet.data);
                  win.webContents.send('network-binary', buf, sender);
                  // FINISH BETA CHANGE 36
                  // Optional: throttle this log if it’s noisy
                  //console.log(`[P2P] Received network message from ${String(sender)}:`, parsedMessage);
                }
              } catch (error) {
                console.error("Failed to forward binary packet:", error);
              }
              // Keep draining in the same tick
              packetSize = steamClient.networking.isP2PPacketAvailable();
            }
          } catch (outerErr) {
            console.error("P2P polling error:", outerErr);
          } finally {
            setTimeout(pollP2PPackets, 16); // ~60Hz polling for lower latency
          }
          //FINISH BETA CHANGE 23 -- drain all queued packets per tick + guard window + lower latency --
        };
        pollP2PPackets(); // Start polling
      } else {
        console.warn("Callback functionality not available in steamClient");
      }
      //finish 

    } catch (error) {
      console.error('Failed to initialize Steamworks:', error);
    }
  } else {
    console.error('steamworkswinx64-withlogs not available, skipping initialization');
  }

  // Load game’s index.html
  win.loadFile(path.join(__dirname, 'game/index.html'));

// Handle external links
//START BETA CHANGE 8 -- guard undefined url in windowOpen handler --
win.webContents.setWindowOpenHandler((details) => {
  const url = details && typeof details.url === 'string' ? details.url : '';
  if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
    try { shell.openExternal(url); } catch (e) { console.warn('[windowOpen] openExternal failed:', e); }
    return { action: 'deny' }; // Prevent new Electron window
  }
  return { action: 'allow' }; // Allow local navigation
});
//FINISH BETA CHANGE 8 -- guard undefined url in windowOpen handler --

  // Sync fullscreen state after page loads
  win.webContents.on('did-finish-load', async () => {
    const isFullScreen = await win.webContents.executeJavaScript('localStorage.getItem("innbcFullScreen") === "true"');
    if (isFullScreen) {
      win.setFullScreen(true);
    }
  });

  // Handle fullscreen changes (from F11, menu, or game toggle)
  win.on('enter-full-screen', () => {
    win.webContents.executeJavaScript('localStorage.setItem("innbcFullScreen", "true")');
    win.webContents.send('fullscreen-changed', true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.executeJavaScript('localStorage.setItem("innbcFullScreen", "false")');
    win.webContents.send('fullscreen-changed', false);
  });

  // Handle IPC for fullscreen toggle
  ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const newState = !win.isFullScreen();
    win.setFullScreen(newState);
    event.sender.executeJavaScript(`localStorage.setItem("innbcFullScreen", "${newState}")`);
    event.sender.send('fullscreen-changed', newState);
  });

  // Open DevTools for debugging (optional, remove for production)
  //win.webContents.openDevTools();
}
//start change -- add IPC handler for quit-game inside app
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
 
  // Handle quit-game IPC message -- add IPC handler for quit-game to exit the application//
  ipcMain.on('quit-game', () => {
    console.log("Received quit-game IPC, initiating app quit");
    app.quit();
  });
  //finish change//
  // start change -- Add IPC handler for trigger-achievement to activate Steam achievements
  ipcMain.on('trigger-achievement', (event, achievementId) => {
    try {
      if (steamClient) {
        steamClient.achievement.activate(achievementId);
        console.log(`Activated achievement: ${achievementId}`);
        setTimeout(() => {
          const isAchieved = steamClient.achievement.isActivated(achievementId);
          console.log(`Achievement ${achievementId} status: ${isAchieved ? 'Unlocked' : 'Locked'}`);
        }, 2000);
      } else {
        console.warn('Steamworks not initialized, cannot activate achievement:', achievementId);
      }
    } catch (error) {
      console.error(`Failed to activate achievement ${achievementId}:`, error);
    }
  });
  //finish change//
  //start change Multiplayer IPC handlers
  ipcMain.on('request-lobby-list', (ipcEvent) => { //ALPHA CHANGE 104
    if (steamClient) {
    //FIXING INDEX.JS LAST ISSUES start: Use async/await for getLobbies and handle errors, use getMemberCount() instead of memberCount
      steamClient.matchmaking.getLobbies().then((lobbies) => {
        const lobbyList = lobbies.map((lobby) => ({
          id: lobby.id,
          players: lobby.getMemberCount(),
          //START ALPHA CHANGE 211 -- include friendly name from lobby data (fallback: numeric id as string) --
          name: (typeof lobby.getData === 'function' && lobby.getData("name")) || String(lobby.id)
          //FINISH ALPHA CHANGE 211 -- include friendly name from lobby data (fallback: numeric id as string) --
        }));
        // Use the original requester (event.sender) and guard against destroyed contents
        try { //START ALPHA CHANGE 104
          const wc = ipcEvent && ipcEvent.sender;
          if (wc && !wc.isDestroyed()) {
            wc.send('lobby-list', lobbyList);
          } else {
            console.warn('[lobbies] No alive webContents to send lobby-list');
          }
        } catch (e) {
          console.warn('[lobbies] Failed to send lobby-list:', e);
        } //FINISH ALPHA CHANGE 104
        console.log('Sent lobby list:', lobbyList);
      }).catch((error) => {
        console.error('Failed to get lobby list:', error);
        // Reply safely to the original requester (even if no window is focused/minimized)
        try { //START ALPHA CHANGE 104
          const wc = ipcEvent && ipcEvent.sender;
          if (wc && !wc.isDestroyed()) {
            wc.send('lobby-list', []);
          } else {
            console.warn('[lobbies] No alive webContents to send empty lobby-list');
          }
        } catch (e) {
          console.warn('[lobbies] Failed to send empty lobby-list:', e);
        } //FINISH ALPHA CHANGE 104
      });
      //FIXING INDEX.JS LAST ISSUES finish
    } else {
      console.warn('Steamworks not initialized, cannot request lobby list');
      try { //START ALPHA CHANGE 104
        const wc = ipcEvent && ipcEvent.sender;
        if (wc && !wc.isDestroyed()) {
          wc.send('lobby-list', []);
        } else {
          console.warn('[lobbies] No alive webContents to send empty lobby-list (no steam)');
        }
      } catch (e) {
        console.warn('[lobbies] Failed to send empty lobby-list (no steam):', e);
      } //FINISH ALPHA CHANGE 104
    }
  });
  ipcMain.on('create-lobby', (ipcEvent, maxPlayers, type) => { //START ALPHA CHANGE 106
  if (steamClient) {
  //FIXING INDEX.JS LAST ISSUES start: Handle Lobby object from createLobby, use steamClient.matchmaking.LobbyType, and add error handling
      steamClient.matchmaking.createLobby(
        type === 'public' ? steamClient.matchmaking.LobbyType.Public : steamClient.matchmaking.LobbyType.FriendsOnly,
        maxPlayers
      ).then((lobby) => {
        currentLobby = lobby; // Store Lobby object
        const lobbyId = lobby ? lobby.id : null;
        // reply to original requester safely
        try {
          const wc = ipcEvent && ipcEvent.sender;
          if (wc && !wc.isDestroyed()) wc.send('lobby-created', lobbyId);
          else console.warn('[create-lobby] No alive webContents to send lobby-created');
        } catch (e) {
          console.warn('[create-lobby] Failed to send lobby-created:', e);
        }
        console.log(`Lobby created with ID: ${lobbyId}`);
      }).catch((error) => {
        console.error('Failed to create lobby:', error);
        // safe fallback reply
        try {
          const wc = ipcEvent && ipcEvent.sender;
          if (wc && !wc.isDestroyed()) wc.send('lobby-created', null);
          else console.warn('[create-lobby] No alive webContents to send lobby-created (null)');
        } catch (e) {
          console.warn('[create-lobby] Failed to send lobby-created (null):', e);
        }
      });
  //FIXING INDEX.JS LAST ISSUES finish    
  } else {
    console.warn('Steamworks not initialized, cannot create lobby');
    try {
      const wc = ipcEvent && ipcEvent.sender;
      if (wc && !wc.isDestroyed()) wc.send('lobby-created', null);
      else console.warn('[create-lobby] No alive webContents to send lobby-created (no steam)');
    } catch (e) {
      console.warn('[create-lobby] Failed to send lobby-created (no steam):', e);
    }
  }
}); //FINISH ALPHA CHANGE 106

  ipcMain.on('join-lobby', (ipcEvent, lobbyId) => { //START ALPHA CHANGE 107
    if (steamClient) {
    //FIXING INDEX.JS LAST ISSUES start: Handle Lobby object from joinLobby and send lobby-joined event
      //START BETA CHANGE 4 -- coerce lobbyId to BigInt for Rust binding --
      const lobbyIdBig = (typeof lobbyId === 'bigint') ? lobbyId : BigInt(lobbyId);
      steamClient.matchmaking.joinLobby(lobbyIdBig).then((lobby) => {
        currentLobby = lobby; // Store Lobby object
        const success = !!lobby;
        // reply to original requester safely
        try {
          const wc = ipcEvent && ipcEvent.sender;
          if (wc && !wc.isDestroyed()) wc.send('lobby-joined', lobbyIdBig, success);
          else console.warn('[join-lobby] No alive webContents to send lobby-joined');
        } catch (e) {
          console.warn('[join-lobby] Failed to send lobby-joined:', e);
        }
        if (success) {
          console.log(`Joined lobby with ID: ${lobbyIdBig}`);
        } else {
          console.warn(`Failed to join lobby with ID: ${lobbyIdBig}`);
        }
      }).catch((error) => {
        console.error('Failed to join lobby:', error);
        // safe fallback reply
        try {
          const wc = ipcEvent && ipcEvent.sender;
          if (wc && !wc.isDestroyed()) wc.send('lobby-joined', lobbyIdBig, false);
          else console.warn('[join-lobby] No alive webContents to send lobby-joined (false)');
        } catch (e) {
          console.warn('[join-lobby] Failed to send lobby-joined (false):', e);
        }
      });
      //FINISH BETA CHANGE 4 -- coerce lobbyId to BigInt for Rust binding --
    //FIXING INDEX.JS LAST ISSUES finish
    } else {
      console.warn('Steamworks not initialized, cannot join lobby');
      try {
        const wc = ipcEvent && ipcEvent.sender;
        if (wc && !wc.isDestroyed()) wc.send('lobby-joined', lobbyId, false);
        else console.warn('[join-lobby] No alive webContents to send lobby-joined (no steam)');
      } catch (e) {
        console.warn('[join-lobby] Failed to send lobby-joined (no steam):', e);
      }
    }
  }); //FINISH ALPHA CHANGE 107

  //START ALPHA CHANGE 212 -- IPC to set friendly lobby name (lobby data "name") on currentLobby --
  ipcMain.on('set-lobby-name', (event, lobbyId, finalName) => {
    try {
      if (!steamClient || !currentLobby) {
        console.warn('[set-lobby-name] No steamClient or currentLobby available');
        return;
      }
      const idMatches = String(currentLobby.id) === String(lobbyId);
      if (!idMatches) {
        console.warn('[set-lobby-name] Provided lobbyId does not match currentLobby.id');
        return;
      }
      if (typeof currentLobby.setData === 'function') {
        const ok = currentLobby.setData("name", String(finalName || '').slice(0, 64));
        console.log(`[set-lobby-name] setData("name")=${ok ? 'ok' : 'failed'} value=${String(finalName)}`);
      } else {
        console.warn('[set-lobby-name] currentLobby.setData is not a function');
      }
    } catch (e) {
      console.error('[set-lobby-name] Failed to set lobby name:', e);
    }
  });
  //FINISH ALPHA CHANGE 212 -- IPC to set friendly lobby name (lobby data "name") on currentLobby --

  ipcMain.on('send-network-message', (event, steamId, message) => {
   //START BETA CHANGE 35 -- disable JSON route; binary only via 'send-network-binary' --
    console.warn('[BINARY-ONLY] send-network-message is disabled. Use send-network-binary instead.');
    return;
    //FINISH BETA CHANGE 35 -- disable JSON route; binary only via 'send-network-binary' --
  });

  //START BETA CHANGE 34 -- binary-only send path (Buffer) --
  ipcMain.on('send-network-binary', (event, steamId, buffer, sendTypeStr) => {
    if (!steamClient) {
      console.warn('Steamworks not initialized, cannot send binary packet');
      return;
    }
    try {
      // map string -> enum, safe fallback to UnreliableNoDelay (or Unreliable)
      const ST = steamClient.networking.SendType;
      const sendType =
        (ST && ST[sendTypeStr]) ? ST[sendTypeStr] :
        (ST.UnreliableNoDelay || ST.Unreliable);

      // ensure Buffer
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      steamClient.networking.sendP2PPacket(
        steamId,
        sendType,
        buf
      );
      // optional: console.log(`Sent binary packet to ${steamId} bytes=${buf.length} type=${sendTypeStr}`);
    } catch (error) {
      console.error(`Failed to send binary packet to ${steamId}:`, error);
    }
  });
  //FINISH BETA CHANGE 34 -- binary-only send path (Buffer) --
  /*
  // LEGACY JSON game start (disabled — binary path is used instead)
  ipcMain.on('send-game-start', (event, steamId) => {
    if (steamClient) {
    //FIXING INDEX.JS LAST ISSUES start: Add error handling for sendP2PPacket
      try {
        //START ALPHA CHANGE 3 -- explicit SendType + Buffer for gameStart signal --
        steamClient.networking.sendP2PPacket(
          steamId,
          steamClient.networking.SendType.Reliable,
          Buffer.from(JSON.stringify({ type: 'gameStart' }))
        );
        //FINISH ALPHA CHANGE 3 -- explicit SendType + Buffer for gameStart signal --
        console.log(`Sent game start signal to ${steamId}`);
      } catch (error) {
        console.error(`Failed to send game start signal to ${steamId}:`, error);
      }
      //FIXING INDEX.JS LAST ISSUES finish
    } else {
      console.warn('Steamworks not initialized, cannot send game start signal');
    }
  });*/
  //START GAMMA CHANGE 35 -- close P2P session with the specified peer (uses new native export)
  ipcMain.on('close-p2p', (event, peerId) => {
    if (!steamClient) {
      console.warn('[P2P] Steamworks not initialized; cannot close P2P for', peerId);
      return;
    }
    try {
      const remoteBig = (typeof peerId === 'bigint') ? peerId : BigInt(peerId);
      steamClient.networking.closeP2PSession(remoteBig);
      console.log('[P2P] Closed P2P session with', String(remoteBig));
    } catch (err) {
      console.error('[P2P] closeP2PSession failed:', err);
    }
  });
  //FINISH GAMMA CHANGE 35 -- close P2P session with the specified peer (uses new native export)
  //FIXING INDEX.JS LAST ISSUES start: Use tracked Lobby object to leave lobby directly
  ipcMain.on('leave-lobby', () => {
    if (steamClient && currentLobby) {
      try {
        currentLobby.leave();
        console.log('Left lobby with ID:', currentLobby.id);
        currentLobby = null;
      } catch (error) {
        console.error('Failed to leave lobby:', error);
      }
    } else {
      console.warn('Steamworks not initialized or no lobby set, cannot leave lobby');
    }
  });
  //FIXING INDEX.JS LAST ISSUES finish
  //finish change Multiplayer IPC handlers
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});