/** The still profile picture: 96 px, from the chosen part or the middle. */
export async function profileImage(file: File, crop?: { x: number; y: number; width: number; height: number }): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("image");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    if (!edge) throw new Error("image");
    context.fillStyle = "#202020";
    context.fillRect(0, 0, 96, 96);
    const part = crop ? [crop.x, crop.y, crop.width, crop.height] as const : [(image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge] as const;
    context.drawImage(image, ...part, 0, 0, 96, 96);
    const result = canvas.toDataURL("image/jpeg", 0.8);
    if (result.length > 20000) throw new Error("size");
    return result;
  } finally { URL.revokeObjectURL(url); }
}
