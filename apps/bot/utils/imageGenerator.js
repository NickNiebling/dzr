const { join } = require("node:path");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { phenotypeLabel } = require("./phenotype");

const RIDER_STATS_FONT = "Inter, Arial, sans-serif";
registerFont(join(__dirname, "../assets/fonts/Inter-Regular.ttf"), { family: "Inter" });

function getRacingScore(rider) {
  if (rider && typeof rider.racingScore === "number" && Number.isFinite(rider.racingScore)) {
    return rider.racingScore;
  }
  const zrsScore = rider?.zrs?.score;
  if (typeof zrsScore === "number" && Number.isFinite(zrsScore)) {
    return zrsScore;
  }
  return null;
}

function roundRect(ctx, x, y, width, height, radius) {
  if (width < 2 * radius) radius = width / 2;
  if (height < 2 * radius) radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  return ctx;
}

function formatMetric({ watts, wkg }) {
  if (watts == null && wkg == null) return "Unavailable";
  if (watts == null) return `${wkg.toFixed(2)} W/kg`;
  if (wkg == null) return `${watts} W`;
  return `${watts} W (${wkg.toFixed(2)} W/kg)`;
}

const CATEGORY_ICONS = {
  "💎": ["#77daff", "diamond"],
  "🔴": ["#d82943"],
  "🟢": ["#40b54b"],
  "🔵": ["#237ee9"],
  "🟣": ["#a64ddd"],
  "🥇": ["#f8cc38", "medal"],
  "🥈": ["#cbd5e1", "medal"],
  "🥉": ["#c88049", "medal"],
  "🟤": ["#96552f"],
  "🟡": ["#ffdc36"],
};

function drawRiderStatsValue(ctx, value, x, y) {
  const [emoji] = String(value).split(" ", 1);
  if (!Object.hasOwn(CATEGORY_ICONS, emoji)) {
    ctx.fillText(value, x, y);
    return;
  }

  // Draw category icons directly so the PNG works without an emoji font.
  const [color, shape] = CATEGORY_ICONS[emoji];
  const centerX = x + 8;
  const centerY = y - 6;
  ctx.save();
  if (shape === "medal") {
    ctx.fillStyle = "#3664aa";
    ctx.fillRect(centerX - 4, centerY - 9, 8, 6);
  }
  ctx.beginPath();
  if (shape === "diamond") {
    ctx.moveTo(centerX, centerY - 8);
    ctx.lineTo(centerX + 8, centerY - 2);
    ctx.lineTo(centerX, centerY + 8);
    ctx.lineTo(centerX - 8, centerY - 2);
    ctx.closePath();
  } else {
    ctx.arc(centerX, centerY + (shape === "medal" ? 2 : 0), shape === "medal" ? 6 : 7, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
  ctx.fillText(value.slice(emoji.length + 1), x + 23, y);
}

async function generateSingleRiderStatsImage(rider) {
  const rows = [
    ["Name", rider.name],
    ["Phenotype", rider.phenotype ?? "—"],
    ["Ladder", rider.ladder.label, true],
    ["vELO2", rider.velo.label, true],
    ["ZRL", rider.zrl.label, true],
    ["zFTP", formatMetric(rider.zFTP)],
    ["zMAP", formatMetric(rider.zMAP)],
    ["ZwiftPower FTP", formatMetric(rider.ftp)],
    ["30s", formatMetric(rider.power.w30)],
    ["1m", formatMetric(rider.power.w60)],
    ["5m", formatMetric(rider.power.w300)],
    ["20m", formatMetric(rider.power.w1200)],
    ["Finishes", rider.race.finishes ?? "—"],
    ["Wins", rider.race.wins ?? "—"],
    ["Podiums", rider.race.podiums ?? "—"],
    ["DNFs", rider.race.dnfs ?? "—"],
  ];
  const rowHeight = 30;
  const topMargin = 150;
  const leftMargin = 50;
  const width = 450;
  const height = topMargin + rows.length * rowHeight + 40;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  roundRect(ctx, 0, 0, canvas.width, canvas.height, 30);
  ctx.clip();

  // Background
  ctx.fillStyle = "#FF6719";
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.1;
  try {
    const image = await loadImage("zwifters.png");
    ctx.drawImage(image, width * 0.1, topMargin, width * 0.8, width * 0.8);
  } catch (err) {
    console.warn("Failed to load image:", err);
  }
  ctx.globalAlpha = 1.0;

  // Horizontal line under title
  ctx.beginPath();
  ctx.moveTo(leftMargin, 90);
  ctx.lineTo(width - leftMargin, 90);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();

  // Title text
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 30px ${RIDER_STATS_FONT}`;
  ctx.fillText("Rider Stats", leftMargin, 70);

  // Row labels
  const xOffset = leftMargin + 180;
  ctx.font = `21px ${RIDER_STATS_FONT}`;
  rows.forEach(([label], i) => {
    ctx.fillText(label, leftMargin, topMargin + i * rowHeight, xOffset - leftMargin - 12);
  });

  // Values
  ctx.font = `16px ${RIDER_STATS_FONT}`;
  rows.forEach(([, value, hasCategoryIcon], i) => {
    const y = topMargin + i * rowHeight;
    if (hasCategoryIcon) drawRiderStatsValue(ctx, value, xOffset, y);
    else ctx.fillText(value, xOffset, y);
  });

  return canvas.toBuffer();
}

async function generateTeamStatsImage(ridersArray) {
  const rowCount = 14;
  const rowHeight = 30;
  const topMargin = 150;
  const leftMargin = 50;
  const colWidth = 220;
  const numCols = ridersArray.length;
  const width = leftMargin + colWidth * numCols + 180;
  const height = topMargin + rowCount * rowHeight + 40;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  roundRect(ctx, 0, 0, width, height, 30);
  ctx.clip();

  // Background
  ctx.fillStyle = "#FF6719";
  ctx.fillRect(0, 0, width, height);

  // Watermark with low opacity
  ctx.globalAlpha = 0.1;
  try {
    const image = await loadImage("zwifters.png");
    const imgWidth = height * 0.7;
    ctx.drawImage(image, width / 2 - imgWidth / 2, topMargin + 10, imgWidth, imgWidth);
  } catch (err) {
    console.warn("Failed to load image:", err);
  }
  ctx.globalAlpha = 1.0;

  // Horizontal line under title
  ctx.beginPath();
  ctx.moveTo(leftMargin, 90);
  ctx.lineTo(width - leftMargin, 90);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();

  // Title text
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 30px Arial";
  ctx.fillText("Team Stats", leftMargin, 70);

  // Row labels
  ctx.font = "bold 22px Arial";
  const labels = [
    "Name", "ZRS", "Pace Group", "vELO Category", "Phenotype",
    "FTP", "30s", "1m", "5m", "20m",
    "Finishes", "😁 Wins", "☺️ Podiums", "😖 DNFs"
  ];
  labels.forEach((label, i) => {
    ctx.fillText(label, leftMargin, topMargin + i * rowHeight);
  });

  // For each rider (each column)
  ctx.font = "bold 16px Arial";
  for (let col = 0; col < numCols; col++) {
    const rider = ridersArray[col];
    let yOffset = topMargin;
    const xOffset = leftMargin + 180 + col * colWidth;
    ctx.fillText(rider.name, xOffset, yOffset);         yOffset += rowHeight;
    const racingScore = getRacingScore(rider);
    const zrsValue = racingScore !== null ? String(Math.round(Number(racingScore))) : "-";
    ctx.fillText(zrsValue, xOffset, yOffset);             yOffset += rowHeight;
    ctx.fillText(rider.zpCategory, xOffset, yOffset);     yOffset += rowHeight;
    const veloCat = `${rider.race.current.mixed.category} (${rider.race.current.rating.toFixed(0)})`;
    ctx.fillText(veloCat, xOffset, yOffset);              yOffset += rowHeight;
    ctx.fillText(phenotypeLabel(rider.phenotype) || "—", xOffset, yOffset);  yOffset += rowHeight;
    const ftpString = `${rider.zpFTP} W (${(rider.zpFTP / rider.weight).toFixed(2)} W/kg)`;
    ctx.fillText(ftpString, xOffset, yOffset);            yOffset += rowHeight;
    const w30String = `${rider.power.w30} W (${rider.power.wkg30.toFixed(2)} W/kg)`;
    ctx.fillText(w30String, xOffset, yOffset);            yOffset += rowHeight;
    const w60String = `${rider.power.w60} W (${rider.power.wkg60.toFixed(2)} W/kg)`;
    ctx.fillText(w60String, xOffset, yOffset);            yOffset += rowHeight;
    const w300String = `${rider.power.w300} W (${rider.power.wkg300.toFixed(2)} W/kg)`;
    ctx.fillText(w300String, xOffset, yOffset);           yOffset += rowHeight;
    const w1200String = `${rider.power.w1200} W (${rider.power.wkg1200.toFixed(2)} W/kg)`;
    ctx.fillText(w1200String, xOffset, yOffset);          yOffset += rowHeight;
    ctx.fillText(`${rider.race.finishes}`, xOffset, yOffset); yOffset += rowHeight;
    ctx.fillText(`${rider.race.wins}`, xOffset, yOffset);     yOffset += rowHeight;
    ctx.fillText(`${rider.race.podiums}`, xOffset, yOffset);  yOffset += rowHeight;
    ctx.fillText(`${rider.race.dnfs}`, xOffset, yOffset);
  }

  return canvas.toBuffer();
}

async function generateEventResultsImage(events) {
  const rowHeight = 30;
  const topMargin = 150;
  const leftMargin = 50;
  const width = 900;
  // Calculate dynamic height based on riders per event
  const sortedEvents = Object.entries(events)
    .sort(([, a], [, b]) => new Date(a.event_info.date) - new Date(b.event_info.date));

  let height = topMargin;
  for (let i = 0; i < sortedEvents.length; i++) {
    const [, event] = sortedEvents[i];
    const riderCount = Array.isArray(event.riders) ? event.riders.length : 0;
    height += 40; // Event title
    height += 40; // Event date
    height += 30; // Column headers
    height += riderCount * rowHeight; // Rider rows
    if (i < sortedEvents.length - 1) {
      height += 40; // Space between events
    }
  }

  // Ensure a reasonable minimum height
  if (height < topMargin + 300) {
    height = topMargin + 300;
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  roundRect(ctx, 0, 0, canvas.width, canvas.height, 30);
  ctx.clip();

  // Background
  ctx.fillStyle = "#FF6719";
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.1;
  try {
    const image = await loadImage("zwifters.png");
    ctx.drawImage(image, width * 0.1, topMargin, width * 0.8, width * 0.8);
  } catch (err) {
    console.warn("Failed to load image:", err);
  }
  ctx.globalAlpha = 1.0;

  // Title text
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 30px Arial";
  ctx.fillText("Event Results", leftMargin, 70);

  // Horizontal line under title
  ctx.beginPath();
  ctx.moveTo(leftMargin, 90);
  ctx.lineTo(width - leftMargin, 90);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();

  let yOffset = topMargin;

  // Events already sorted above

  for (const [, event] of sortedEvents) {
    // Event title
    ctx.font = "bold 24px Arial";
    ctx.fillText(event.event_info.title, leftMargin, yOffset);
    yOffset += 40;

    // Event date
    ctx.font = "20px Arial";
    ctx.fillText(event.event_info.date, leftMargin, yOffset);
    yOffset += 40;

    // Column headers
    ctx.font = "bold 18px Arial";
    const headers = ["Rider", "Cat", "Pos", "Time", "1m", "5m", "20m"];
    // Rider, Cat, Pos, Time, 1m, 5m, 20m
    const colWidths = [200, 50, 50, 140, 70, 60, 60];
    let xOffset = leftMargin;
    // Rider
    ctx.textAlign = "left";
    ctx.fillText(headers[0], xOffset, yOffset);
    xOffset += colWidths[0];
    // Cat
    ctx.textAlign = "left";
    ctx.fillText(headers[1], xOffset, yOffset);
    xOffset += colWidths[1];
    // Pos (right aligned)
    ctx.textAlign = "right";
    ctx.fillText(headers[2], xOffset + colWidths[2] - 10, yOffset); // -10 for padding
    xOffset += colWidths[2];
    // Time (centered)
    ctx.textAlign = "center";
    const timeColCenter = xOffset + colWidths[3] / 2;
    ctx.fillText(headers[3], timeColCenter, yOffset);
    xOffset += colWidths[3];
    // 1m, 5m, 20m
    ctx.textAlign = "left";
    ctx.fillText(headers[4], xOffset + 20, yOffset); // extra space after Time
    xOffset += colWidths[4];
    ctx.fillText(headers[5], xOffset, yOffset);
    xOffset += colWidths[5];
    ctx.fillText(headers[6], xOffset, yOffset);
    yOffset += 30;

    // Sort riders by category and position
    const sortedRiders = event.riders.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.position_in_cat - b.position_in_cat;
    });

    // Rider rows
    ctx.font = "16px Arial";
    for (const rider of sortedRiders) {
      xOffset = leftMargin;
      ctx.textAlign = "left";
      const name = rider.name.replace(/\[.*?\]/g, '').trim();
      ctx.fillText(name, xOffset, yOffset);
      xOffset += colWidths[0];
      ctx.textAlign = "left";
      ctx.fillText(rider.category, xOffset, yOffset);
      xOffset += colWidths[1];
      ctx.textAlign = "right";
      ctx.fillText(rider.position_in_cat.toString(), xOffset + colWidths[2] - 10, yOffset);
      xOffset += colWidths[2];
      ctx.textAlign = "center";
      ctx.fillText(rider.time, xOffset + colWidths[3] / 2, yOffset);
      xOffset += colWidths[3];
      ctx.textAlign = "left";
      ctx.fillText(rider["1m wkg"], xOffset + 20, yOffset);
      xOffset += colWidths[4];
      ctx.fillText(rider["5m wkg"], xOffset, yOffset);
      xOffset += colWidths[5];
      ctx.fillText(rider["20m wkg"], xOffset, yOffset);
      yOffset += 30;
    }
    yOffset += 40; // Add space between events
  }

  return canvas.toBuffer();
}

module.exports = {
  generateSingleRiderStatsImage,
  generateTeamStatsImage,
  generateEventResultsImage,
}; 