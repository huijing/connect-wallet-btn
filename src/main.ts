import "./style.css";

type ToastLevel = "error" | "warn";
type EIP1193ProviderEvent = "accountsChanged" | "disconnect";

interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: EIP1193ProviderEvent, listener: (...args: unknown[]) => void): void;
  removeListener?(event: EIP1193ProviderEvent, listener: (...args: unknown[]) => void): void;
  disconnect?(): Promise<unknown>;
}

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

interface EIP6963AnnounceProviderEvent extends CustomEvent<EIP6963ProviderDetail> {}

interface WalletError {
  code?: number;
  message: string;
}

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": EIP6963AnnounceProviderEvent;
  }
}

const state = {
  address: null as string | null,
  currentProvider: null as EIP1193Provider | null,
  discoveredProviders: [] as EIP6963ProviderDetail[],
  toastTimer: 0 as number | undefined,
};

const connectArea = document.querySelector<HTMLDivElement>(".wallet-connect")!;
const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
const walletForm = dialog.querySelector<HTMLFormElement>("form")!;
const cancelButton = walletForm.querySelector<HTMLButtonElement>(".btn-cancel")!;

dialog.setAttribute("closedby", "any");
dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "selected") {
    showError({ message: "User rejected the request." });
  }
});

bindProviderDiscovery();
renderConnectArea();
renderWallets();

function bindProviderDiscovery() {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { detail } = event;

    if (state.discoveredProviders.some((wallet) => wallet.provider === detail.provider)) {
      return;
    }

    state.discoveredProviders.push(detail);
    renderWallets();
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function bindProvider(provider: EIP1193Provider | null) {
  if (state.currentProvider?.removeListener) {
    state.currentProvider.removeListener("accountsChanged", handleAccountsChanged);
    state.currentProvider.removeListener("disconnect", resetConnectionState);
  }

  state.currentProvider = provider;

  if (provider?.on) {
    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("disconnect", resetConnectionState);
  }
}

function handleAccountsChanged(accounts: unknown) {
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    resetConnectionState();
    return;
  }

  state.address = accounts[0];
  renderConnectArea();
}

async function connectWith(provider: EIP1193Provider) {
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });

    if (Array.isArray(accounts) && typeof accounts[0] === "string") {
      bindProvider(provider);
      state.address = accounts[0];
      renderConnectArea();
    }
  } catch (error) {
    showError(toWalletError(error));
  } finally {
    dialog.close("selected");
  }
}

async function disconnect() {
  const provider = state.currentProvider;

  if (!provider) {
    showError({ message: "No provider set" });
    return;
  }

  try {
    if (typeof provider.disconnect === "function") {
      await withTimeout(provider.disconnect());
    } else {
      await withTimeout(
        provider.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        }),
      );
    }

    const accounts = await withTimeout(provider.request({ method: "eth_accounts" }), 1000).catch(
      () => null,
    );

    if (Array.isArray(accounts) && accounts.length > 0) {
      resetConnectionState();
      showError(
        {
          message: "Disconnect from your browser wallet extension to fully sign out.",
        },
        "warn",
      );
      return;
    }

    resetConnectionState();
  } catch (error) {
    const walletError = toWalletError(error);

    if (walletError.code === -32601) {
      resetConnectionState();
      showError(
        {
          message: "Disconnect from your browser wallet extension to fully sign out.",
        },
        "warn",
      );
      return;
    }

    showError(walletError);
  }
}

function resetConnectionState() {
  bindProvider(null);
  state.address = null;
  renderConnectArea();
}

function renderConnectArea() {
  connectArea.replaceChildren();

  if (state.address) {
    const address = document.createElement("span");
    address.textContent = `${state.address.slice(0, 6)}…${state.address.slice(-4)}`;

    const button = document.createElement("button");
    button.className = "btn-connect";
    button.type = "button";
    button.textContent = "Disconnect";
    button.addEventListener("click", disconnect);

    connectArea.append(address, button);
    return;
  }

  const button = document.createElement("button");
  button.className = "btn-connect";
  button.type = "button";
  button.textContent = "Connect Wallet";
  button.addEventListener("click", () => dialog.showModal());

  connectArea.append(button);
}

function renderWallets() {
  walletForm.querySelectorAll("[data-wallet-entry]").forEach((node) => {
    node.remove();
  });

  if (state.discoveredProviders.length === 0) {
    const empty = document.createElement("div");
    empty.dataset.walletEntry = "empty";
    empty.textContent = "No supported wallets detected.";
    walletForm.insertBefore(empty, cancelButton);
    return;
  }

  for (const { info, provider } of state.discoveredProviders) {
    const button = document.createElement("button");
    button.dataset.walletEntry = "option";
    button.type = "button";
    button.className = "btn-wallet";
    button.addEventListener("click", () => {
      void connectWith(provider);
    });

    if (info.icon) {
      const icon = document.createElement("img");
      icon.className = "wallet-icon";
      icon.src = info.icon;
      icon.alt = info.name;
      button.append(icon);
    }

    const label = document.createElement("span");
    label.textContent = info.name || info.rdns || info.uuid;
    button.append(label);

    walletForm.insertBefore(button, cancelButton);
  }
}

function showError(error: WalletError, level: ToastLevel = "error") {
  const message = error.message.replace(/\nVersion:[\s\S]*$/, "");
  const prefix = level === "warn" ? "Wallet warning:" : "Wallet error:";
  const details = error.code === undefined ? [prefix, message] : [prefix, error.code, message];

  if (level === "warn") {
    console.warn(...details);
  } else {
    console.error(...details);
  }

  const existing = document.querySelector(".toast-message");
  existing?.remove();

  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }

  const toast = document.createElement("div");
  toast.className = "toast-message";
  toast.textContent = message;
  document.body.append(toast);

  state.toastTimer = window.setTimeout(() => {
    toast.remove();
    state.toastTimer = undefined;
  }, 3000);
}

function toWalletError(error: unknown): WalletError {
  if (error && typeof error === "object") {
    return {
      code: "code" in error && typeof error.code === "number" ? error.code : undefined,
      message:
        "message" in error && typeof error.message === "string" ? error.message : "Unknown error",
    };
  }

  return { message: "Unknown error" };
}

function withTimeout<T>(promise: Promise<T>, delay = 1500): Promise<T> {
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject({ code: -32000, message: "Operation timed out" });
    }, delay);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}
