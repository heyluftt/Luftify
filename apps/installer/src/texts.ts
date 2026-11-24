const de = {
  setup: "Setup",
  install: "Luftify installieren",
  update: "Luftify aktualisieren",
  version: "Version {version} · {size} MB",
  go: "Installieren",
  goUpdate: "Aktualisieren",
  busy: "Installiert …",
  folder: "Ordner ändern",
  steps: ["Dateien kopieren", "Audio einrichten", "Verknüpfungen anlegen", "In Windows eintragen"],
  done: "Fertig",
  ready: "Luftify ist bereit",
  start: "Luftify starten",
  failed: "Die Installation hat nicht geklappt.",
  retry: "Noch einmal",
  classic: "Klassischen Installer öffnen",
  close: "Schließen",
  minimize: "Minimieren",
};

const en: typeof de = {
  setup: "Setup",
  install: "Install Luftify",
  update: "Update Luftify",
  version: "Version {version} · {size} MB",
  go: "Install",
  goUpdate: "Update",
  busy: "Installing …",
  folder: "Change folder",
  steps: ["Copying files", "Setting up audio", "Creating shortcuts", "Registering with Windows"],
  done: "Done",
  ready: "Luftify is ready",
  start: "Start Luftify",
  failed: "The installation did not work.",
  retry: "Try again",
  classic: "Open the classic installer",
  close: "Close",
  minimize: "Minimize",
};

export const german = navigator.language.toLowerCase().startsWith("de");
export const text = german ? de : en;
