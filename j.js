// === Car Purchase Block Script ===

// Range to search for spawned cars
var SEARCH_RANGE = 5;

// Storage key so each player only triggers once per session
var PURCHASE_TAG = "carPurchaseTriggered";

// ========== CONFIGURABLE CARS ==========
// Format: { name: "NPC Name", tab: tabNumber, price: amount, priceItem: "item:id" }
var CARS = [
    { name: "FC1", tab: 6, price: 3, priceItem: "coins:emerald_coin" }
    // Add more cars here:
    // { name: "FC2", tab: 7, price: 5, priceItem: "coins:diamond_coin" },
    // { name: "Speedster", tab: 8, price: 10, priceItem: "minecraft:diamond" }
];

// ========== GUI State ==========
var guiRef = null;
var lastBlock = null;
var lastPlayer = null;
var lastAPI = null;

// ========== Block Interaction ==========

function interact(event) {
    var block = event.block;
    var player = event.player;
    var api = event.API;

    lastBlock = block;
    lastPlayer = player;
    lastAPI = api;

    showCarPurchaseGUI(player, api);
}

// ========== Helper: Get lostCar status ==========

function getLostCarStatus(player) {
    var val = player.getStoreddata().get("lostCar");
    return val === "true";
}

// ========== Car Purchase GUI ==========

function showCarPurchaseGUI(player, api) {
    var guiWidth = 280;
    var guiHeight = 80 + (CARS.length * 30) + 50; // extra space for teleport button

    guiRef = api.createCustomGui(guiWidth, guiHeight, 0, false, player);
    guiRef.addLabel(1, "§l§n🚗 Car Dealership", guiWidth / 2, -30, 1.0, 1.0);

    var yPos = -10;
    for (var i = 0; i < CARS.length; i++) {
        var car = CARS[i];
        var labelId = 100 + i;
        var buttonId = 200 + i;

        guiRef.addLabel(labelId, "§f" + car.name + " §7- §a" + car.price + "x §f" + car.priceItem, 20, yPos, 0.9, 0.9);
        guiRef.addButton(buttonId, "§aBuy", guiWidth - 50, yPos - 2, 40, 16);

        yPos -= 30;
    }

    // ===== Teleport Car Mode Toggle =====
    var lostCar = getLostCarStatus(player);
    var teleportStatusColor = lostCar ? "§a" : "§c";
    var teleportStatusText = lostCar ? "ON" : "OFF";

    guiRef.addLabel(300, "§eTeleport Car Mode: " + teleportStatusColor + teleportStatusText, 20, yPos - 5, 0.9, 0.9);
    guiRef.addButton(301, lostCar ? "§cDisable" : "§aEnable", guiWidth - 70, yPos - 7, 60, 16);

    yPos -= 30;

    // Close button
    guiRef.addButton(999, "§cClose", guiWidth / 2 - 25, yPos - 20, 50, 16);

    player.showCustomGui(guiRef);
}

// ========== Button Handler ==========

function customGuiButton(event) {
    var player = event.player;
    var buttonId = event.buttonId;
    var api = event.API;

    if (!lastBlock || !lastPlayer) return;

    // Close button
    if (buttonId === 999) {
        player.closeGui();
        return;
    }

    // Teleport Car Mode toggle
    if (buttonId === 301) {
        var current = getLostCarStatus(player);
        var newVal = !current;
        player.getStoreddata().put("lostCar", newVal ? "true" : "false");

        var statusMsg = newVal
            ? "§aTeleport Car Mode §lENABLED§r§a. Your car will teleport to you!"
            : "§cTeleport Car Mode §lDISABLED§r§c.";
        player.message(statusMsg);

        // Refresh GUI to reflect new state
        player.closeGui();
        showCarPurchaseGUI(player, api);
        return;
    }

    // Car purchase buttons (200-299)
    if (buttonId >= 200 && buttonId < 300) {
        var carIndex = buttonId - 200;
        if (carIndex >= 0 && carIndex < CARS.length) {
            purchaseCar(player, lastBlock, CARS[carIndex], api);
        }
        return;
    }
}

// ========== Purchase Logic ==========

function purchaseCar(player, block, carConfig, api) {
    var playerName = player.getName();

    var inv = player.getInventory().getItems();
    var totalHave = 0;
    for (var i = 0; i < inv.length; i++) {
        if (inv[i] && inv[i].getName() === carConfig.priceItem) {
            totalHave += inv[i].getStackSize();
        }
    }

    if (totalHave < carConfig.price) {
        player.message("§cNot enough! Need " + carConfig.price + "x " + carConfig.priceItem);
        return;
    }

    var toRemove = carConfig.price;
    for (var i = 0; i < inv.length; i++) {
        if (inv[i] && inv[i].getName() === carConfig.priceItem && toRemove > 0) {
            var amt = Math.min(toRemove, inv[i].getStackSize());
            inv[i].setStackSize(inv[i].getStackSize() - amt);
            toRemove -= amt;
        }
    }

    var spawnX = player.getX();
    var spawnY = player.getY() + 3;
    var spawnZ = player.getZ();

    var world = block.getWorld();
    var spawnedCar = world.spawnClone(spawnX, spawnY, spawnZ, carConfig.tab, carConfig.name);

    if (spawnedCar) {
        registerCarOwner(spawnedCar, playerName, carConfig.price, carConfig.priceItem);
        player.message("§a✓ Car purchased! Your §f" + carConfig.name + " §ahas spawned.");
        player.message("§eHold a §fFlight Control §estick and right-click to fly!");
        giveFlightControl(player, api);
    } else {
        player.message("§cFailed to spawn car. Contact admin.");
    }

    player.closeGui();
}

// ========== Car Registration ==========

function registerCarOwner(carNpc, playerName, pricePaid, priceItem) {
    var carData = {
        owner: playerName,
        members: [],
        pricePaid: pricePaid
    };
    carNpc.getStoreddata().put("carData", JSON.stringify(carData));
    carNpc.getStoreddata().put("fuel", "0");
}

// ========== Give Flight Control Stick ==========

function giveFlightControl(player, api) {
    var nbt = api.stringToNbt(JSON.stringify({
        id: "minecraft:stick",
        Count: 1,
        tag: { display: { Name: '{"text":"Flight Control"}' } }
    }));
    player.giveItem(player.world.createItemFromNbt(nbt));
}

// ========== GUI Closed ==========

function customGuiClosed(event) {
    guiRef = null;
    lastBlock = null;
    lastPlayer = null;
}
