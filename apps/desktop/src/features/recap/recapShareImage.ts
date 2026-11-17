import { sizedCoverUrl } from "../../components/coverSizing";
import { appLanguage, t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { joinCreatorNames } from "../analytics/analyticsFormatting";
import type { CoverPalette } from "../theme/coverPalette";
import { recapActivity } from "./recapChartData";
import { recapAmount, recapCount, recapPersona } from "./recapFormat";
import type { RecapFacts } from "./recapPlan";
import type { ListeningRecap, RecapPeriod } from "./recapTypes";

/**
 * The end card as one picture to keep or share, 1080 × 1350 (4:5). Same
 * layout as RecapPoster: every `cqw` there is `U` pixels here, so card and
 * image match. Drawn by hand instead of screenshotting the DOM: covers are
 * data URLs, so the canvas stays exportable.
 */
const WIDTH = 1080;
const HEIGHT = 1350;
const U = WIDTH / 100;
const PAD = 6 * U;
const GAP = 3.6 * U;
const INNER = WIDTH - PAD * 2;

function loadImage(source: string | undefined): Promise<HTMLImageElement | undefined> {
  if (!source?.startsWith("data:image/")) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = source;
  });
}

/** A row thumbnail as data URL, small variant first. */
async function thumbnail(coverUri: string | null | undefined): Promise<HTMLImageElement | undefined> {
  if (!coverUri?.startsWith("https://")) return undefined;
  const sized = sizedCoverUrl(coverUri, "small", 1.5);
  try {
    return await loadImage(await desktopApi.coverData(sized));
  } catch {
    try { return await loadImage(await desktopApi.coverData(coverUri)); } catch { return undefined; }
  }
}

function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && context.measureText(`${text.slice(0, end)}…`).width > width) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Shrinks the font until the line fits; cuts only below the smallest size. */
function fitSize(context: CanvasRenderingContext2D, text: string, width: number, weight: number, size: number, min: number, font: string): string {
  let current = size;
  context.font = `${weight} ${current}px ${font}`;
  while (current > min && context.measureText(text).width > width) {
    current -= 2;
    context.font = `${weight} ${current}px ${font}`;
  }
  return fit(context, text, width);
}

function roundedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, size: number, radius: number) {
  context.save();
  context.beginPath();
  context.roundRect(x, y, size, size, radius);
  context.clip();
  context.drawImage(image, x, y, size, size);
  context.restore();
}

function spacing(context: CanvasRenderingContext2D, value: string) {
  if ("letterSpacing" in context) context.letterSpacing = value;
}

/** Small uppercase label, as in the poster's h4/dt/small. */
function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, alpha = 0.7) {
  context.font = `800 ${size}px ${font}`;
  spacing(context, `${(size * 0.12).toFixed(1)}px`);
  context.globalAlpha = alpha;
  context.fillText(text.toUpperCase(), x, y);
  context.globalAlpha = 1;
  spacing(context, "0px");
}

export async function renderRecapImage(input: {
  recap: ListeningRecap;
  period: RecapPeriod;
  facts: RecapFacts;
  palette: CoverPalette;
  coverData?: string;
}): Promise<Blob> {
  const { recap, period, facts, palette } = input;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const tracks = recap.overview.topTracks.slice(0, 5);
  const [cover, ...thumbs] = await Promise.all([
    loadImage(input.coverData),
    ...tracks.map((entry) => thumbnail(entry.track.coverUri)),
  ]);

  // Background: cover colours, a light from the top right, the blurred cover, a veil.
  const angle = (150 * Math.PI) / 180;
  const dx = Math.sin(angle) * WIDTH;
  const dy = -Math.cos(angle) * HEIGHT;
  const background = context.createLinearGradient(WIDTH / 2 - dx / 2, HEIGHT / 2 - dy / 2, WIDTH / 2 + dx / 2, HEIGHT / 2 + dy / 2);
  background.addColorStop(0, palette.primary);
  background.addColorStop(0.55, palette.secondary);
  background.addColorStop(1, palette.shadow);
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const light = context.createRadialGradient(WIDTH * 0.88, HEIGHT * 0.06, 0, WIDTH * 0.88, HEIGHT * 0.06, WIDTH * 0.8);
  light.addColorStop(0, "rgba(255,255,255,0.26)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = light;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  if (cover) {
    context.save();
    context.filter = `blur(${9 * U}px) saturate(1.4)`;
    context.globalAlpha = 0.55;
    const size = Math.max(WIDTH, HEIGHT) * 1.4;
    context.drawImage(cover, (WIDTH - size) / 2, (HEIGHT - size) / 2, size, size);
    context.restore();
  }
  const veil = context.createLinearGradient(0, 0, 0, HEIGHT);
  veil.addColorStop(0, "rgba(0,0,0,0.18)");
  veil.addColorStop(0.6, "rgba(0,0,0,0.46)");
  veil.addColorStop(1, "rgba(0,0,0,0.62)");
  context.fillStyle = veil;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = "#ffffff";
  context.textBaseline = "top";

  // Head: brand, title, dates.
  let y = PAD;
  context.strokeStyle = "rgba(255,255,255,0.78)";
  context.lineWidth = 0.5 * U;
  context.beginPath();
  context.arc(PAD + 1.1 * U, y + 1.5 * U, 0.85 * U, 0, Math.PI * 2);
  context.stroke();
  label(context, t("recap.brand"), PAD + 3.8 * U, y, 2.6 * U, font, 0.78);
  y += 3.8 * U;
  context.fillText(fitSize(context, period.title, INNER, 850, 6.6 * U, 4.6 * U, font), PAD, y);
  y += 7.4 * U;
  context.font = `550 ${2.6 * U}px ${font}`;
  context.globalAlpha = 0.76;
  context.fillText(fit(context, period.dates, INNER), PAD, y);
  context.globalAlpha = 1;
  y += 3.6 * U + GAP;

  // Hero: the top cover and the time.
  const coverSize = 30 * U;
  const heroY = y;
  if (cover) {
    context.save();
    context.shadowColor = "rgba(0,0,0,0.6)";
    context.shadowBlur = 7 * U;
    context.shadowOffsetY = 3 * U;
    context.fillStyle = "rgba(0,0,0,0.3)";
    context.beginPath();
    context.roundRect(PAD, heroY, coverSize, coverSize, 3 * U);
    context.fill();
    context.restore();
    roundedImage(context, cover, PAD, heroY, coverSize, 3 * U);
  }
  const amount = recapAmount(recap.overview.totalListeningMs);
  const textX = cover ? PAD + coverSize + GAP : PAD;
  const blockHeight = 14 * U * 0.9 + 0.6 * U + 4.4 * U + 3 * U + 6.6 * U;
  let amountY = heroY + (coverSize - blockHeight) / 2;
  context.fillStyle = "#ffffff";
  context.font = `900 ${14 * U}px ${font}`;
  context.fillText(recapCount(amount.value), textX - 0.5 * U, amountY - 1.2 * U);
  amountY += 14 * U * 0.9 + 0.6 * U;
  context.font = `750 ${3.7 * U}px ${font}`;
  context.fillText(amount.unit, textX, amountY);
  amountY += 4.4 * U + 3 * U;
  const stats = [
    [t("recap.page.stat.plays"), recapCount(recap.overview.qualifiedPlayCount)],
    [t("recap.summary.activeDays"), `${facts.activeDays}/${facts.periodDays}`],
  ] as const;
  let statX = textX;
  for (const [name, value] of stats) {
    label(context, name, statX, amountY, 2 * U, font);
    context.font = `800 ${3.7 * U}px ${font}`;
    context.fillText(value, statX, amountY + 2.4 * U);
    context.font = `800 ${2 * U}px ${font}`;
    statX += Math.max(context.measureText(name.toUpperCase()).width * 1.14, context.measureText(value).width) + GAP;
  }
  y = heroY + coverSize + GAP;

  // Lists: songs with thumbnails, artists with the number one a size up.
  const songsWidth = (INNER - GAP) * (1.3 / 2.3);
  const artistsX = PAD + songsWidth + GAP;
  const artistsWidth = INNER - songsWidth - GAP;
  const rowHeight = 5.9 * U;
  const rowGap = 1.3 * U;
  label(context, t("recap.summary.topSongs"), PAD, y, 2.2 * U, font);
  label(context, t("recap.summary.topArtists"), artistsX, y, 2.2 * U, font);
  const rowsY = y + 2.2 * U * 1.2 + 1.6 * U;
  tracks.forEach((entry, index) => {
    const rowY = rowsY + index * (rowHeight + rowGap);
    context.textBaseline = "middle";
    context.font = `900 ${3 * U}px ${font}`;
    context.fillText(String(index + 1), PAD, rowY + rowHeight / 2);
    const thumbX = PAD + 3.4 * U + 1.8 * U;
    const thumb = thumbs[index];
    const thumbSize = 5.4 * U;
    if (thumb) roundedImage(context, thumb, thumbX, rowY + (rowHeight - thumbSize) / 2, thumbSize, 1 * U);
    const copyX = thumbX + thumbSize + 1.8 * U;
    const copyWidth = PAD + songsWidth - copyX;
    context.font = `750 ${2.8 * U}px ${font}`;
    context.fillText(fit(context, entry.track.title, copyWidth), copyX, rowY + rowHeight * 0.32);
    context.font = `400 ${2.1 * U}px ${font}`;
    context.globalAlpha = 0.7;
    context.fillText(fit(context, joinCreatorNames(entry.track.creators), copyWidth), copyX, rowY + rowHeight * 0.76);
    context.globalAlpha = 1;
  });
  recap.overview.topArtists.slice(0, 5).forEach((entry, index) => {
    const rowY = rowsY + index * (rowHeight + rowGap) + rowHeight / 2;
    context.font = `900 ${3 * U}px ${font}`;
    context.fillText(String(index + 1), artistsX, rowY);
    const nameX = artistsX + 3.4 * U + 1.8 * U;
    context.font = index === 0 ? `850 ${3.4 * U}px ${font}` : `750 ${2.8 * U}px ${font}`;
    context.fillText(fit(context, entry.creator.name, artistsX + artistsWidth - nameX), nameX, rowY);
  });
  context.textBaseline = "top";

  // Foot: listening type and the period as a tiny bar line.
  const footPadX = 3.6 * U;
  const footPadY = 3.2 * U;
  const footHeight = footPadY * 2 + 2 * U + 0.6 * U + 4.9 * U;
  const footY = HEIGHT - PAD - footHeight;
  context.fillStyle = "rgba(255,255,255,0.13)";
  context.beginPath();
  context.roundRect(PAD, footY, INNER, footHeight, 3 * U);
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#ffffff";
  const sparkWidth = 28 * U;
  const sparkHeight = 7.4 * U;
  label(context, t("recap.summary.type"), PAD + footPadX, footY + footPadY, 2 * U, font, 0.72);
  context.font = `850 ${4.1 * U}px ${font}`;
  context.fillText(fit(context, recapPersona(facts), INNER - footPadX * 3 - sparkWidth), PAD + footPadX, footY + footPadY + 2.6 * U);

  const activity = recapActivity(recap.overview.dailyActivity, period, appLanguage());
  const max = activity.peak >= 0 ? activity.bars[activity.peak]!.value : 0;
  if (max > 0) {
    const count = activity.bars.length;
    const gap = 0.5 * U;
    const barWidth = (sparkWidth - gap * (count - 1)) / count;
    const sparkX = PAD + INNER - footPadX - sparkWidth;
    const baseY = footY + footHeight - footPadY;
    activity.bars.forEach((bar, index) => {
      const ratio = bar.value > 0 ? Math.max(0.1, bar.value / max) : 0.04;
      const height = sparkHeight * ratio;
      context.fillStyle = index === activity.peak ? "#ffffff" : "rgba(255,255,255,0.4)";
      context.beginPath();
      context.roundRect(sparkX + index * (barWidth + gap), baseY - height, barWidth, height, Math.min(0.5 * U, barWidth / 2));
      context.fill();
    });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("export failed"))), "image/png");
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
