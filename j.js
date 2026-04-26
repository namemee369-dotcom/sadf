// === Car Purchase Block Script ===

var SEARCH_RANGE = 5;
var PURCHASE_TAG = "carPurchaseTriggered";

// ========== CONFIGURABLE CARS ==========
var CARS = [
    { name: "FC1", tab: 6, price: 3, priceItem: "coins:emerald_coin" }
    // Add more cars here:
    // { name: "FC2", tab: 7, price: 5, priceItem: "coins:diamond_coin" },
    // { name: "Speedster", tab: 8, price: 10, priceItem: "minecraft:diamond" }
];

// ========== Layout Constants ==========
var GUI_WIDTH        = 230;
var TELEPORT_BTN_X   = 120;
var TELEPORT_BTN_W   = 48;
var TELEPORT_BTN_H   = 16;

// ========== GUI State ==========
var guiRef       = null;
var lastBlock    = null;
var lastPlayer   = null;
var lastAPI      = null;
var teleportBtnY = 0;

// ========== Safe Update ==========
function safeUpdate(gui) {
    if (!gui) return;
    try { gui.update(); } catch(e) {}
}

// ========== Block Interaction ==========
function interact(event) {
    lastBlock  = event.block;
    lastPlayer = event.player;
    lastAPI    = event.API;
    showCarPurchaseGUI(lastPlayer, lastAPI);
}

// ========== World StoredData: Lost Car List Helpers ==========
function getLostCarList(world) {
    var wdata = world.getStoreddata();
    if (!wdata.has("lostCarPlayers")) return [];
    try {
        return JSON.parse(wdata.get("lostCarPlayers"));
    } catch(e) {
        return [];
    }
}

function saveLostCarList(world, list) {
    world.getStoreddata().put("lostCarPlayers", JSON.stringify(list));
}

function isPlayerLostCar(world, playerName) {
    var list = getLostCarList(world);
    for (var i = 0; i < list.length; i++) {
        if (list[i] === playerName) return true;
    }
    return false;
}

function addPlayerToLostCar(world, playerName) {
    var list = getLostCarList(world);
    for (var i = 0; i < list.length; i++) {
        if (list[i] === playerName) return; // already in list
    }
    list.push(playerName);
    saveLostCarList(world, list);
}

function removePlayerFromLostCar(world, playerName) {
    var list = getLostCarList(world);
    var newList = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i] !== playerName) newList.push(list[i]);
    }
    saveLostCarList(world, newList);
}

// ========== Car Purchase GUI ==========
function showCarPurchaseGUI(player, api) {
    var guiHeight = 80 + (CARS.length * 30) + 50;
    var world = lastBlock.getWorld();

    guiRef = api.createCustomGui(GUI_WIDTH, guiHeight, 0, false, player);
    guiRef.addLabel(1, "§l§n🚗 Car Dealership", 40, -120, 1.0, 1.0);

    var yPos = -10;
    for (var i = 0; i < CARS.length; i++) {
        var car = CARS[i];
        guiRef.addLabel(100 + i, "§f" + car.name + " §7- §a" + car.price + "x §f" + car.priceItem, 20, yPos, 0.9, 0.9);
        guiRef.addButton(200 + i, "§aBuy", GUI_WIDTH - 50, yPos - 2, 40, 16);
        yPos -= 30;
    }

    // ===== Teleport Car Mode Toggle =====
    var lostCar = isPlayerLostCar(world, player.getName());
    teleportBtnY = yPos - 9;
    guiRef.addLabel(300, "§eTeleport Car Mode:", 20, yPos - 5, 0.9, 0.9);
    guiRef.addButton(301, lostCar ? "§aEnabled" : "§cDisabled", TELEPORT_BTN_X, teleportBtnY, TELEPORT_BTN_W, TELEPORT_BTN_H);

    yPos -= 30;

    guiRef.addButton(999, "§cClose", GUI_WIDTH / 2 - 25, yPos - 20, 50, 16);

    player.showCustomGui(guiRef);
}

// ========== Button Handler ==========
function customGuiButton(event) {
    var player   = event.player;
    var buttonId = event.buttonId;
    var api      = event.API;

    if (!lastBlock || !lastPlayer) return;

    if (buttonId === 999) {
        player.closeGui();
        return;
    }

    if (buttonId === 301) {
        var world      = lastBlock.getWorld();
        var playerName = player.getName();
        var current    = isPlayerLostCar(world, playerName);
        var newVal     = !current;

        if (newVal) {
            addPlayerToLostCar(world, playerName);
        } else {
            removePlayerFromLostCar(world, playerName);
        }

        var statusMsg = newVal
            ? "§aTeleport Car Mode §lENABLED§r§a. Your car will teleport to you!"
            : "§cTeleport Car Mode §lDISABLED§r§c.";
        player.message(statusMsg);

        try { guiRef.removeComponent(301); } catch(e) {}
        guiRef.addButton(301, newVal ? "§aEnabled" : "§cDisabled", TELEPORT_BTN_X, teleportBtnY, TELEPORT_BTN_W, TELEPORT_BTN_H);
        safeUpdate(guiRef);
        return;
    }

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

    var inv       = player.getInventory().getItems();
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

    var world      = block.getWorld();
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
    guiRef     = null;
    lastBlock  = null;
    lastPlayer = null;
}
