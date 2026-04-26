// === Flying Car Script with Owner/Member System + Fuel Slot + Storage ===

var flightTimerId = 20;
var checkTimerId = 21;
var step = 0.8;
var pitch, pl, rot;
var motionX = 0, motionY = 0, motionZ = 0;
var decay = 0.05;
var npcYaw = 0;

var restrictedItems = [
    "minecraft:sugar"
];

// Car price and home coordinates — edit these as needed
var CAR_PRICE_ITEM = "coins:emerald_coin";
var CAR_PRICE_AMOUNT = 3;
var CAR_HOME_X = 2432;
var CAR_HOME_Y = 162;
var CAR_HOME_Z = 874;

// Allowed teleport boundary (XZ box)
var CORNER1_X = 635;
var CORNER1_Z = 2262;
var CORNER2_X = 3197;
var CORNER2_Z = -1314;

var MIN_X = Math.min(CORNER1_X, CORNER2_X);
var MAX_X = Math.max(CORNER1_X, CORNER2_X);
var MIN_Z = Math.min(CORNER1_Z, CORNER2_Z);
var MAX_Z = Math.max(CORNER1_Z, CORNER2_Z);
var CAR_BASE_NAME = "FC1";

// Fuel Settings
var FUEL_ITEM = "minecraft:coal";
var FUEL_CONSUME_AMOUNT = 1;
var FUEL_CONSUME_INTERVAL = 200; // ticks (1200 = 1 minute)

// GUI state
var guiRef = null;
var lastAPI = null;
var _lastNpcRef = null;

// Slot refs
var fuelSlot = null;
var highlightedSlot = null;
var highlightLineIds = [];

// Flight state
var flightTicks = 0;
var fuelWarningSent = false;
var fuelWarning20 = false;
var fuelWarning10 = false;
var fuelWarning5 = false;

// ========== Init ==========

function init(event) {
    event.npc.ai.stopOnInteract = false;
    event.npc.ai.returnsHome = false;
    npcYaw = event.npc.getRotation();
    event.npc.getStats().setMaxHealth(1000);
    event.npc.getStats().setCombatRegen(0);
    event.npc.getStats().setHealthRegen(0);
    var carData = getCarData(event.npc);
    if (carData.owner) {
        event.npc.getDisplay().setName(CAR_BASE_NAME + " (" + carData.owner + ")");
    }
}

// ========== Data Helpers ==========

function getCarData(npc) {
    var data = npc.getStoreddata();
    if (!data.has("carData")) {
        data.put("carData", JSON.stringify({ owner: null, members: [], pricePaid: 0 }));
    }
    return JSON.parse(data.get("carData"));
}

function saveCarData(npc, carData) {
    npc.getStoreddata().put("carData", JSON.stringify(carData));
}

function isOwner(npc, playerName) {
    return getCarData(npc).owner === playerName;
}

function isMember(npc, playerName) {
    var data = getCarData(npc);
    for (var i = 0; i < data.members.length; i++) {
        if (data.members[i] === playerName) return true;
    }
    return false;
}

function canDrive(npc, playerName) {
    return isOwner(npc, playerName) || isMember(npc, playerName);
}

function getFuelAmount(npc) {
    var data = npc.getStoreddata();
    return data.has("fuel") ? parseInt(data.get("fuel")) : 0;
}

function saveFuelAmount(npc, amount) {
    npc.getStoreddata().put("fuel", "" + amount);
}

function hasFuel(npc) {
    return getFuelAmount(npc) >= FUEL_CONSUME_AMOUNT;
}

function consumeFuel(npc) {
    var amount = getFuelAmount(npc);
    if (amount < FUEL_CONSUME_AMOUNT) return false;
    saveFuelAmount(npc, amount - FUEL_CONSUME_AMOUNT);
    return true;
}

function giveFlightControl(player, api) {
    var nbt = api.stringToNbt(JSON.stringify({
        id: "minecraft:stick",
        Count: 1,
        tag: { display: { Name: '{"text":"Flight Control"}' } }
    }));
    player.giveItem(player.world.createItemFromNbt(nbt));
}

// ========== Interact ==========

function interact(event) {
    var player = event.player;
    var npc = event.npc;
    _lastNpcRef = npc;
    lastAPI = event.API;

    var handItem = player.getMainhandItem();
    var isFlightControl = handItem && handItem.getDisplayName && handItem.getDisplayName() == "Flight Control";

    var carData = getCarData(npc);
    var playerName = player.getName();

    if (isFlightControl) {
        if (!carData.owner) { player.message("§cThis car has no owner. Purchase it first!"); return; }
        if (!canDrive(npc, playerName)) { player.message("§cYou are not authorized to drive this car!"); return; }
        if (hasRestrictedItem(player)) { player.message("§cYou cannot use the taxi with packages!"); return; }
        npc.addRider(player);
        flightTicks = 0;
        fuelWarningSent = false;
        fuelWarning20 = false;
        fuelWarning10 = false;
        fuelWarning5 = false;
        if (!hasFuel(npc)) {
            player.message("§cThis car has no fuel.");
            fuelWarningSent = true;
        }
        npc.timers.stop(flightTimerId);
        npc.timers.start(flightTimerId, 1, true);
        npc.timers.stop(checkTimerId);
        npc.timers.start(checkTimerId, 400, true);
        return;
    }

    if (!isFlightControl) {
        if (!carData.owner) {
            showPurchaseGUI(player, npc, event.API);
        } else if (isOwner(npc, playerName)) {
            showOwnerGUI(player, npc, event.API, carData);
        } else {
            showViewerGUI(player, npc, event.API, carData);
        }
    }
}

// ========== GUIs ==========

function showPurchaseGUI(player, npc, api) {
    guiRef = api.createCustomGui(200, 120, 0, false, player);
    guiRef.addLabel(101, "§l§nCar for Sale", 100, -50, 1.0, 1.0);
    guiRef.addLabel(102, "§7Price: §a" + CAR_PRICE_AMOUNT + "x §f" + CAR_PRICE_ITEM, 100, -30, 0.9, 0.9);
    guiRef.addButton(10, "§aPurchase", 60, 10, 80, 20);
    guiRef.addButton(11, "§cClose", 60, 40, 80, 20);
    player.showCustomGui(guiRef);
}

function showOwnerGUI(player, npc, api, carData) {
    fuelSlot = null;
    highlightedSlot = null;
    highlightLineIds = [];

    // Widen GUI to fit member list on the right (original was 240, +110 for right column)
    guiRef = api.createCustomGui(350, 260, 0, false, player);

    guiRef.addLabel(101, "§l§nYour Car", 120, -125, 1.0, 1.0);

    // Fuel slot (top right) — original position
    guiRef.addLabel(130, "§6⛽ Fuel:", 21, 28, 0.8, 0.8);
    fuelSlot = guiRef.addItemSlot(21, 38);
    var fuelAmt = getFuelAmount(npc);
    if (fuelAmt > 0) {
        try { fuelSlot.setStack(player.world.createItem(FUEL_ITEM, Math.min(fuelAmt, 100))); } catch(e) {}
    }

    // Add member input — original position
    guiRef.addLabel(110, "§7Add member:", 20, -70, 0.8, 0.8);
    guiRef.addTextField(50, 105, -70, 90, 14).setText("");
    guiRef.addButton(20, "§aAdd", 202, -71, 30, 16);

    // Teleport fields — original position
    guiRef.addLabel(115, "§7Teleport (x,y,z):", 20, -45, 0.8, 0.8);
    guiRef.addTextField(60, 105, -47, 90, 14);
    guiRef.addButton(22, "§bGo", 202, -48, 30, 16);

    // Player inventory — original position
    guiRef.showPlayerInventory(49, 90, false);

    // Owner action buttons — original position
    guiRef.addButton(21, "§eSell Car", 19, -10, 60, 18);

    // ── RIGHT COLUMN: Members list (60px further right than before) ──
    guiRef.addLabel(102, "§eMembers:", 250, -70, 0.9, 0.9);

    // Build member list BEFORE showing the GUI so guiRef is still valid
    renderMemberList(carData);
    player.showCustomGui(guiRef);
}

// Renders (or re-renders) just the member rows in the right column.
// Component IDs 120-124 = member name labels
// Component IDs 200-204 = remove buttons
// Component ID  103     = "None" placeholder
function renderMemberList(carData) {
    // Clear previous member rows
    for (var i = 0; i < 5; i++) {
        try { guiRef.removeComponent(120 + i); } catch(e) {}
        try { guiRef.removeComponent(200 + i); } catch(e) {}
    }
    try { guiRef.removeComponent(103); } catch(e) {}

    var yPos = -55;
    if (carData.members.length === 0) {
        guiRef.addLabel(103, "§7None", 250, yPos, 0.8, 0.8);
    } else {
        for (var i = 0; i < Math.min(carData.members.length, 5); i++) {
            guiRef.addLabel(120 + i, "§f" + carData.members[i], 250, yPos, 0.8, 0.8);
            guiRef.addButton(200 + i, "§cX", 340, yPos - 1, 14, 14);
            yPos += 16;
        }
    }
}

function showViewerGUI(player, npc, api, carData) {
    fuelSlot = null;
    highlightedSlot = null;
    highlightLineIds = [];

    var playerName = player.getName();

    if (isMember(npc, playerName)) {
        guiRef = api.createCustomGui(240, 130, 0, false, player);
        guiRef.addLabel(101, "§l§nCar Storage", 120, -65, 1.0, 1.0);

    guiRef.addLabel(130, "§6⛽ Fuel:", 21, 28, 0.8, 0.8);
    fuelSlot = guiRef.addItemSlot(21, 39);
        var fuelAmt = getFuelAmount(npc);
        if (fuelAmt > 0) {
            try { fuelSlot.setStack(player.world.createItem(FUEL_ITEM, Math.min(fuelAmt, 100))); } catch(e) {}
        }

        guiRef.showPlayerInventory(0, 43, false);

        guiRef.addButton(11, "§7Close", 85, 50, 50, 16);
    } else {
        guiRef = api.createCustomGui(220, 120, 0, false, player);
        guiRef.addLabel(101, "§l§nCar Info", 110, -50, 1.0, 1.0);
        guiRef.addLabel(102, "§7Owner: §f" + (carData.owner || "None"), 110, -30, 0.9, 0.9);
    guiRef.addLabel(130, "§6⛽ Fuel:", 21, 28, 0.8, 0.8);
    fuelSlot = guiRef.addItemSlot(21, 39);
        var fuelAmt = getFuelAmount(npc);
        if (fuelAmt > 0) {
            try { fuelSlot.setStack(player.world.createItem(FUEL_ITEM, Math.min(fuelAmt, 100))); } catch(e) {}
        }
        guiRef.addButton(11, "§7Close", 85, 30, 50, 16);
    }

    player.showCustomGui(guiRef);
}

// ========== Slot Clicked ==========

function customGuiSlotClicked(event) {
    var clickedSlot = event.slot;
    var stack = event.stack;
    var player = event.player;
    var npc = _lastNpcRef;
    if (!npc || !guiRef) return;

    var playerName = player.getName();

    if (clickedSlot === fuelSlot) {
        if (!canDrive(npc, playerName)) { guiRef.update(); return; }
        highlightedSlot = fuelSlot;
        drawFuelHighlight();
        return;
    }

    if (highlightedSlot === fuelSlot) {
        if (!canDrive(npc, playerName)) { guiRef.update(); return; }

        var fuelAmt = getFuelAmount(npc);
        var slotStack = fuelSlot.getStack();
        var maxStack = stack ? stack.getMaxStackSize() : 100;

        if (stack && !stack.isEmpty()) {
            if (stack.getName() !== FUEL_ITEM) { guiRef.update(); return; }
            if (slotStack && !slotStack.isEmpty()) {
                var total = slotStack.getStackSize() + stack.getStackSize();
                if (total <= maxStack) {
                    fuelAmt = total;
                    player.removeItem(stack, stack.getStackSize());
                } else {
                    var overflow = total - maxStack;
                    fuelAmt = maxStack;
                    var overflowItem = player.world.createItemFromNbt(stack.getItemNbt());
                    overflowItem.setStackSize(overflow);
                    player.removeItem(stack, stack.getStackSize());
                    player.giveItem(overflowItem);
                }
            } else {
                fuelAmt = stack.getStackSize();
                player.removeItem(stack, stack.getStackSize());
            }
            saveFuelAmount(npc, fuelAmt);
            try { fuelSlot.setStack(player.world.createItem(FUEL_ITEM, Math.min(fuelAmt, 100))); } catch(e) {}
        } else if (slotStack && !slotStack.isEmpty()) {
            player.giveItem(slotStack);
            fuelSlot.setStack(player.world.createItem("minecraft:air", 1));
            fuelAmt = 0;
            saveFuelAmount(npc, fuelAmt);
        }

        try { guiRef.removeComponent(130); } catch(e) {}
        guiRef.addLabel(130, "§6⛽ Fuel:", 21, 28, 0.8, 0.8);
        guiRef.update();
        return;
    }
}

function drawFuelHighlight() {
    for (var i = 0; i < highlightLineIds.length; i++) {
        try { guiRef.removeComponent(highlightLineIds[i]); } catch(e) {}
    }
    highlightLineIds = [];
    var x = 20, y = 37, w = 18, h = 18;
    highlightLineIds.push(guiRef.addColoredLine(500, x,   y,   x+w, y,   0xADD8E6, 2));
    highlightLineIds.push(guiRef.addColoredLine(501, x,   y+h, x+w, y+h, 0xADD8E6, 2));
    highlightLineIds.push(guiRef.addColoredLine(502, x,   y,   x,   y+h, 0xADD8E6, 2));
    highlightLineIds.push(guiRef.addColoredLine(503, x+w, y,   x+w, y+h, 0xADD8E6, 2));
    guiRef.update();
}

// ========== GUI Closed ==========

function customGuiClosed(event) {
    guiRef = null;
    fuelSlot = null;
    highlightedSlot = null;
    highlightLineIds = [];
}

// ========== Button Handler ==========

function customGuiButton(event) {
    var player = event.player;
    var npc = _lastNpcRef;
    if (!npc) { player.closeGui(); return; }

    var carData = getCarData(npc);
    var playerName = player.getName();
    var api = event.API;

    if (event.buttonId === 11 || event.buttonId === 23) {
        player.closeGui();
        return;
    }

    // Purchase
    if (event.buttonId === 10) {
        if (carData.owner) { player.message("§cThis car is already owned!"); player.closeGui(); return; }
        var inv = player.getInventory().getItems();
        var totalHave = 0;
        for (var i = 0; i < inv.length; i++) {
            if (inv[i] && inv[i].getName() === CAR_PRICE_ITEM) totalHave += inv[i].getStackSize();
        }
        if (totalHave < CAR_PRICE_AMOUNT) {
            player.message("§cNot enough! Need " + CAR_PRICE_AMOUNT + "x " + CAR_PRICE_ITEM);
            return;
        }
        var toRemove = CAR_PRICE_AMOUNT;
        for (var i = 0; i < inv.length; i++) {
            if (inv[i] && inv[i].getName() === CAR_PRICE_ITEM && toRemove > 0) {
                var amt = Math.min(toRemove, inv[i].getStackSize());
                inv[i].setStackSize(inv[i].getStackSize() - amt);
                toRemove -= amt;
            }
        }
        carData.owner = playerName;
        carData.members = [];
        carData.pricePaid = CAR_PRICE_AMOUNT;
        saveCarData(npc, carData);
        giveFlightControl(player, api);
        npc.getDisplay().setName(CAR_BASE_NAME + " (" + playerName + ")");
        player.message("§aCar purchased! You are now the owner.");
        player.message("§eYou received a §fFlight Control §estick. Hold it and right-click the car to fly!");
        player.closeGui();
        return;
    }

    // Add member — NO close/reopen, just update the member list in-place
    if (event.buttonId === 20) {
        if (!isOwner(npc, playerName)) return;
        var gui = event.gui;
        var field = gui ? gui.getComponent(50) : null;
        var newMember = field ? field.getText().trim() : "";
        if (newMember.length === 0) { player.message("§cEnter a player name!"); return; }
        if (newMember === playerName) { player.message("§cYou can't add yourself!"); return; }
        if (isMember(npc, newMember)) { player.message("§c" + newMember + " is already a member!"); return; }
        if (carData.members.length >= 5) { player.message("§cMax 5 members allowed!"); return; }
        carData.members.push(newMember);
        saveCarData(npc, carData);
        player.message("§aAdded member: §f" + newMember);
        // Clear the text field
        try { field.setText(""); } catch(e) {}
        // Refresh only the member list, keep the rest of the GUI intact
        renderMemberList(carData);
        guiRef.update();
        return;
    }

    // Sell car
    if (event.buttonId === 21) {
        if (!isOwner(npc, playerName)) return;
        var refund = carData.pricePaid || 1;
        if (refund > 0) {
            player.giveItem(player.world.createItem(CAR_PRICE_ITEM, refund));
            player.message("§aRefunded §f" + refund + "x " + CAR_PRICE_ITEM);
        }
        carData.owner = null;
        carData.members = [];
        saveCarData(npc, carData);
        npc.getDisplay().setName(CAR_BASE_NAME);
        player.closeGui();
        npc.despawn();
        return;
    }

    // Teleport
    if (event.buttonId === 22) {
        if (!isOwner(npc, playerName)) return;
        var gui = event.gui;
        var field = gui ? gui.getComponent(60) : null;
        var raw = field ? field.getText().trim() : "";
        var parts = raw.split(",");
        if (parts.length !== 3) { player.message("§cFormat must be: x,y,z"); return; }
        var tx = parseFloat(parts[0].trim());
        var ty = parseFloat(parts[1].trim()) + 3;
        var tz = parseFloat(parts[2].trim());
        if (isNaN(tx) || isNaN(ty) || isNaN(tz)) { player.message("§cInvalid coordinates!"); return; }
        if (tx < MIN_X || tx > MAX_X || tz < MIN_Z || tz > MAX_Z) { player.message("§cCoordinates are outside the allowed area!"); return; }
        npc.setPosition(tx, ty, tz);
        player.message("§bCar teleported to §f" + tx + ", " + ty + ", " + tz);
        player.closeGui();
        return;
    }

    // Remove member buttons (200–204) — NO close/reopen, just update member list in-place
    if (event.buttonId >= 200 && event.buttonId <= 204) {
        if (!isOwner(npc, playerName)) return;
        var memberIndex = event.buttonId - 200;
        if (memberIndex < carData.members.length) {
            var removed = carData.members[memberIndex];
            carData.members.splice(memberIndex, 1);
            saveCarData(npc, carData);
            player.message("§eRemoved member: §f" + removed);
            // Refresh only the member list
            renderMemberList(carData);
            guiRef.update();
        }
        return;
    }
}

// ========== Flight Timer ==========

function timer(event) {
    var npc = event.npc;

    if (event.id == flightTimerId) {
        var riders = npc.getRiders();
        var usingControl = false;

        if (riders.length > 0) {
            pl = riders[0];
            if (pl.mainhandItem && pl.mainhandItem.displayName == "Flight Control") {
                if (hasFuel(npc)) {
                    usingControl = true;
                    fuelWarningSent = false;
                    flightTicks++;
                    if (flightTicks >= FUEL_CONSUME_INTERVAL) {
                        consumeFuel(npc);
                        flightTicks = 0;
                        
                        // Check fuel level and send warnings at thresholds
                        var currentFuel = getFuelAmount(npc);
                        if (currentFuel === 20 && !fuelWarning20) {
                            pl.message("§e⚠ Warning: Only §620% fuel §eleft!");
                            fuelWarning20 = true;
                            fuelWarning10 = false;
                            fuelWarning5 = false;
                        } else if (currentFuel === 10 && !fuelWarning10) {
                            pl.message("§6⚠ Warning: Only §c10% fuel §6left!");
                            fuelWarning10 = true;
                            fuelWarning5 = false;
                        } else if (currentFuel === 5 && !fuelWarning5) {
                            pl.message("§c⚠⚠ Critical: Only §45% fuel §cleft! Land now!");
                            fuelWarning5 = true;
                        }
                    }
                    
                    pitch = Number(pl.getPitch().toFixed(2));
                    rot = Number(pl.getRotation().toFixed(2));
                    if (rot < 0) rot += 360;
                    npcYaw = lerpAngle(npcYaw, rot, 0.2);
                    npc.setRotation(npcYaw);
                    var targetX = step * -Math.sin(toRadians(rot));
                    var targetZ = step * Math.cos(toRadians(rot));
                    var targetY = 0;
                    if (pitch >= 20) targetY = -step;
                    else if (pitch <= -20) targetY = step;
                    motionX = lerp(motionX, targetX, 0.2);
                    motionY = lerp(motionY, targetY, 0.2);
                    motionZ = lerp(motionZ, targetZ, 0.2);
                } else {
                    if (!fuelWarningSent) {
                        pl.message("§cThe car ran out of fuel!");
                        fuelWarningSent = true;
                    }
                }
            }
        }

        if (!usingControl) {
            if (riders.length === 0) { flightTicks = 0; fuelWarningSent = false; }
            motionX = lerp(motionX, 0, decay);
            motionY = lerp(motionY, 0, decay);
            motionZ = lerp(motionZ, 0, decay);
        }

        npc.setMotionX(motionX);
        npc.setMotionY(motionY);
        npc.setMotionZ(motionZ);
    }

    if (event.id == checkTimerId) {
        var riders = npc.getRiders();
        if (riders.length > 0) {
            var p = riders[0];
            var carData = getCarData(npc);
            if (hasRestrictedItem(p)) {
                removeRestrictedItems(p);
                p.setMount(null);
                p.message("§cYour package was confiscated and you were removed from the car!");
            }
            if (!canDrive(npc, p.getName())) {
                p.setMount(null);
                p.message("§cYou are no longer authorized to drive this car!");
                npc.timers.stop(flightTimerId);
                npc.timers.stop(checkTimerId);
                flightTicks = 0;
            }
        } else {
            npc.timers.stop(checkTimerId);
        }
    }
}

// ========== Utility ==========

function toRadians(angle) { return angle * (Math.PI / 180); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
    var diff = ((b - a + 540) % 360) - 180;
    return (a + diff * t + 360) % 360;
}

function hasRestrictedItem(player) {
    var inv = player.getInventory().getItems();
    for (var i = 0; i < inv.length; i++) {
        if (inv[i] != null) {
            for (var r = 0; r < restrictedItems.length; r++) {
                if (inv[i].getName() == restrictedItems[r]) return true;
            }
        }
    }
    return false;
}

function removeRestrictedItems(player) {
    var inv = player.getInventory().getItems();
    for (var i = 0; i < inv.length; i++) {
        if (inv[i] != null) {
            for (var r = 0; r < restrictedItems.length; r++) {
                if (inv[i].getName() == restrictedItems[r]) inv[i].setStackSize(0);
            }
        }
    }
}
