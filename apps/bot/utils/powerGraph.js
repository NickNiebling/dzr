// powerGraph.js
const { createCanvas } = require("canvas");

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

// generatePowerLineGraph accepts either a single rider object or an array of rider objects.
// It uses custom x-axis spacing so that 5s, 10s, 30s, 60s are close together, 5m is further, and 20m is even further.
async function generatePowerLineGraph(input) {
  const riders = Array.isArray(input) ? input : [input];

  // Durations in seconds, in axis order: 5, 10, 30, 60, 300, 1200.
  const durationLabels = ["5s", "10s", "30s", "1m", "5m", "20m"];
  // Custom normalized x positions (0 to 1): first four points are close together.
  const xPositionsNormalized = [0, 0.05, 0.2, 0.35, 0.6, 1.0];

  // Canvas dimensions and margins.
  const width = 800;
  const height = 500;
  const margin = 100;
  const graphWidth = width - 2 * margin;
  const graphHeight = height - 2 * margin;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Apply rounded edges.
  roundRect(ctx, 0, 0, width, height, 30);
  ctx.clip();

  // Background fill.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // --- Draw Axes ---
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 2;
  // Y-axis.
  ctx.beginPath();
  ctx.moveTo(margin, margin);
  ctx.lineTo(margin, height - margin);
  ctx.stroke();
  // X-axis.
  ctx.beginPath();
  ctx.moveTo(margin, height - margin);
  ctx.lineTo(width - margin, height - margin);
  ctx.stroke();

  // --- Draw X-Axis Labels using custom spacing ---
  ctx.font = "bold 16px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  for (let i = 0; i < durationLabels.length; i++) {
    const x = margin + xPositionsNormalized[i] * graphWidth;
    ctx.fillText(durationLabels[i], x, height - margin + 20);
  }

  // --- Draw Y-Axis Labels and Grid (evenly spaced) ---
  ctx.textAlign = "right";
  const numYLabels = 5;
  let dataMax = 0;
  riders.forEach(rider => {
    const riderMax = Math.max(
      rider.power.w5,
      rider.power.w15,
      rider.power.w30,
      rider.power.w60,
      rider.power.w300,
      rider.power.w1200
    );
    if (riderMax > dataMax) dataMax = riderMax;
  });
  const yMax = Math.ceil(dataMax / 100) * 100;
  for (let i = 0; i <= numYLabels; i++) {
    const yValue = (yMax * i) / numYLabels;
    const y = height - margin - (i / numYLabels) * graphHeight;
    ctx.fillText(yValue.toFixed(0) + " W", margin - 10, y + 5);
    ctx.strokeStyle = "#dddddd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
  }

  // --- Draw the Line Graph for Each Rider ---
  const colors = ["#FF0000", "#00AA00", "#0000FF", "#FFA500", "#800080", "#008080", "#FFC0CB", "#FFFF00"];
  riders.forEach((rider, index) => {
    const powerValues = [
      rider.power.w5,
      rider.power.w15,
      rider.power.w30,
      rider.power.w60,
      rider.power.w300,
      rider.power.w1200
    ];
    const color = colors[index % colors.length];

    // Draw the continuous line connecting the data points.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < powerValues.length; i++) {
      const x = margin + xPositionsNormalized[i] * graphWidth;
      const y = height - margin - (powerValues[i] / yMax) * graphHeight;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw circles at each data point.
    ctx.fillStyle = color;
    for (let i = 0; i < powerValues.length; i++) {
      const x = margin + xPositionsNormalized[i] * graphWidth;
      const y = height - margin - (powerValues[i] / yMax) * graphHeight;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // --- Draw Legend (Top Right) ---
  const legendX = width - margin - 170;
  let legendY = margin + 10;
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "left";
  riders.forEach((rider, index) => {
    const color = colors[index % colors.length];
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY, 15, 15);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(rider.name, legendX + 20, legendY + 13);
    legendY += 20;
  });

  // --- Title ---
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Power Curve", width / 2, margin - 40);

  return canvas.toBuffer();
}

// generatePowerLineGraph accepts either a single rider object or an array of rider objects.
// It uses custom x-axis spacing so that 5s, 10s, 30s, 60s are close together, 5m is further, and 20m is even further.
async function generatePowerLineGraph2(input) {
  const riders = Array.isArray(input) ? input : [input];

  // Durations in seconds, in axis order: 5, 10, 30, 60, 300, 1200.
  const durationLabels = ["5s", "10s", "30s", "1m", "5m", "20m"];
  // Custom normalized x positions (0 to 1): first four points are close together.
  const xPositionsNormalized = [0, 0.05, 0.2, 0.35, 0.6, 1.0];

  // Canvas dimensions and margins.
  const width = 800;
  const height = 500;
  const margin = 100;
  const graphWidth = width - 2 * margin;
  const graphHeight = height - 2 * margin;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Apply rounded edges.
  roundRect(ctx, 0, 0, width, height, 30);
  ctx.clip();

  // Background fill.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // --- Draw Axes ---
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 2;
  // Y-axis.
  ctx.beginPath();
  ctx.moveTo(margin, margin);
  ctx.lineTo(margin, height - margin);
  ctx.stroke();
  // X-axis.
  ctx.beginPath();
  ctx.moveTo(margin, height - margin);
  ctx.lineTo(width - margin, height - margin);
  ctx.stroke();

  // --- Draw X-Axis Labels using custom spacing ---
  ctx.font = "bold 16px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  for (let i = 0; i < durationLabels.length; i++) {
    const x = margin + xPositionsNormalized[i] * graphWidth;
    ctx.fillText(durationLabels[i], x, height - margin + 20);
  }

  // --- Draw Y-Axis Labels and Grid (evenly spaced) ---
  ctx.textAlign = "right";
  const numYLabels = 5;
  let dataMax = 0;
  riders.forEach(rider => {
    const riderMax = Math.max(
      rider.power.wkg5,
      rider.power.wkg15,
      rider.power.wkg30,
      rider.power.wkg60,
      rider.power.wkg300,
      rider.power.wkg1200
    );
    if (riderMax > dataMax) dataMax = riderMax;
  });
  const yMax = Math.ceil(dataMax);
  for (let i = 0; i <= numYLabels; i++) {
    const yValue = (yMax * i) / numYLabels;
    const y = height - margin - (i / numYLabels) * graphHeight;
    ctx.fillText(yValue.toFixed(0) + " Wkg", margin - 10, y + 5);
    ctx.strokeStyle = "#dddddd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
  }

  // --- Draw the Line Graph for Each Rider ---
  const colors = ["#FF0000", "#00AA00", "#0000FF", "#FFA500", "#800080", "#008080", "#FFC0CB", "#FFFF00"];
  riders.forEach((rider, index) => {
    const powerValues = [
      rider.power.wkg5,
      rider.power.wkg15,
      rider.power.wkg30,
      rider.power.wkg60,
      rider.power.wkg300,
      rider.power.wkg1200
    ];
    const color = colors[index % colors.length];

    // Draw the continuous line connecting the data points.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < powerValues.length; i++) {
      const x = margin + xPositionsNormalized[i] * graphWidth;
      const y = height - margin - (powerValues[i] / yMax) * graphHeight;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw circles at each data point.
    ctx.fillStyle = color;
    for (let i = 0; i < powerValues.length; i++) {
      const x = margin + xPositionsNormalized[i] * graphWidth;
      const y = height - margin - (powerValues[i] / yMax) * graphHeight;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // --- Draw Legend (Top Right) ---
  const legendX = width - margin - 170;
  let legendY = margin + 10;
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "left";
  riders.forEach((rider, index) => {
    const color = colors[index % colors.length];
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY, 15, 15);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(rider.name, legendX + 20, legendY + 13);
    legendY += 20;
  });

  // --- Title ---
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Power Curve", width / 2, margin - 40);

  return canvas.toBuffer();
}

module.exports = {
  generatePowerLineGraph,
  generatePowerLineGraph2
};
