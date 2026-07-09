"use client";

import { CheckCircle2, ImageIcon, Link2, Loader2, Pencil, Plus, Trash2, Upload, X, XCircle } from "lucide-react";
import { type ClipboardEvent, type DragEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import type { FmdTool, Profile } from "@/lib/types";
import {
  fmdToolCategoryOptions,
  maxCuratedFmdToolLinks,
  type FmdToolDraft,
  type FmdToolMetadataDraft,
  type FmdToolPreviewImageUpload,
} from "@/features/tools/model/fmd-tools";
import type { FmdQuickLinkDialogMode } from "@/features/tools/model/fmd-quick-links-view";
import {
  classNames,
  UiButton,
  UiField,
  UiNotice,
  UiTextArea,
  UiTextInput,
} from "@/shared/atoms/ui-primitives";

const metadataLoadDelayMs = 900;

type MetadataStatus = "idle" | "loading" | "success" | "error";

type DialogNotice = {
  tone: "success" | "danger";
  message: string;
};

function isValidHttpUrl(value: string) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  } catch {
    return false;
  }
}

export function FmdQuickLinkDialog({
  mode,
  draft,
  pending,
  currentProfile,
  curatedLinkCount,
  curatedLimitReached,
  onClose,
  onDraftChange,
  onLoadMetadata,
  onSubmit,
  onUploadPreviewImage,
}: {
  mode: FmdQuickLinkDialogMode;
  draft: FmdToolDraft;
  pending: boolean;
  currentProfile: Profile | null;
  curatedLinkCount: number;
  curatedLimitReached: boolean;
  onClose: () => void;
  onDraftChange: (draft: FmdToolDraft) => void;
  onLoadMetadata: (url: string) => Promise<FmdToolMetadataDraft | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUploadPreviewImage: (file: File) => Promise<FmdToolPreviewImageUpload | null>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef(draft);
  const metadataDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataRequestIdRef = useRef(0);
  const lastLoadedMetadataUrlRef = useRef("");
  const [metadataStatus, setMetadataStatus] = useState<MetadataStatus>("idle");
  const [imagePending, setImagePending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dialogNotice, setDialogNotice] = useState<DialogNotice | null>(null);
  const title = mode === "edit" ? "Link bearbeiten" : "Link eintragen";
  const submitLabel = mode === "edit" ? "Speichern" : "Eintragen";
  const patchDraft = (patch: Partial<FmdToolDraft>) => {
    const nextDraft = { ...draftRef.current, ...patch };
    draftRef.current = nextDraft;
    setDialogNotice(null);
    onDraftChange(nextDraft);
  };
  const linkPresent = Boolean(draft.url.trim());
  const curateDisabled = pending || (!draft.isCurated && (!linkPresent || curatedLimitReached));
  const previewImageUrl = draft.previewImageUrl.trim();
  const curatedWarning = linkPresent && curatedLimitReached && !draft.isCurated
      ? `Es sind bereits ${maxCuratedFmdToolLinks} kuratierte Links gesetzt.`
      : "";

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const loadMetadata = useCallback(async (url: string) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      setMetadataStatus("idle");
      return;
    }
    if (!isValidHttpUrl(normalizedUrl)) {
      setMetadataStatus("error");
      setDialogNotice({ tone: "danger", message: "Link muss mit http:// oder https:// beginnen." });
      return;
    }
    if (lastLoadedMetadataUrlRef.current === normalizedUrl) return;

    const requestId = metadataRequestIdRef.current + 1;
    metadataRequestIdRef.current = requestId;
    lastLoadedMetadataUrlRef.current = normalizedUrl;
    setMetadataStatus("loading");
    setDialogNotice(null);
    try {
      const metadata = await onLoadMetadata(normalizedUrl);
      if (requestId !== metadataRequestIdRef.current || draftRef.current.url.trim() !== normalizedUrl) return;
      if (!metadata) {
        setMetadataStatus("error");
        setDialogNotice({ tone: "danger", message: "Metadaten konnten nicht übernommen werden." });
        return;
      }

      const currentDraft = draftRef.current;
      const nextDraft: FmdToolDraft = {
        ...currentDraft,
        name: currentDraft.name.trim() ? currentDraft.name : metadata.title,
        description: currentDraft.description.trim() ? currentDraft.description : metadata.description,
      };

      if (metadata.imageUrl && currentDraft.previewImageSource !== "manual" && !currentDraft.previewImageUrl.trim()) {
        nextDraft.previewImageUrl = metadata.imageUrl;
        nextDraft.previewImageSource = "og";
      }

      draftRef.current = nextDraft;
      onDraftChange(nextDraft);
      setMetadataStatus("success");
      setDialogNotice({ tone: "success", message: metadata.title || metadata.description || metadata.imageUrl ? "Metadaten übernommen." : "Metadaten geprüft." });
    } catch {
      if (requestId !== metadataRequestIdRef.current || draftRef.current.url.trim() !== normalizedUrl) return;
      setMetadataStatus("error");
      setDialogNotice({ tone: "danger", message: "Metadaten konnten nicht übernommen werden." });
    }
  }, [onDraftChange, onLoadMetadata]);

  useEffect(() => {
    if (metadataDebounceRef.current) clearTimeout(metadataDebounceRef.current);

    const normalizedUrl = draft.url.trim();
    if (!normalizedUrl) return undefined;
    if (!isValidHttpUrl(normalizedUrl) || lastLoadedMetadataUrlRef.current === normalizedUrl) return undefined;

    metadataDebounceRef.current = setTimeout(() => {
      void loadMetadata(normalizedUrl);
    }, metadataLoadDelayMs);

    return () => {
      if (metadataDebounceRef.current) clearTimeout(metadataDebounceRef.current);
    };
  }, [draft.url, loadMetadata]);

  async function handlePreviewFile(file: File | null | undefined) {
    if (!file || imagePending) return;
    setImagePending(true);
    setDialogNotice(null);
    try {
      const uploaded = await onUploadPreviewImage(file);
      if (!uploaded) return;
      onDraftChange({
        ...draft,
        previewImageUrl: uploaded.imageUrl,
        previewImageSource: uploaded.source,
      });
      setDialogNotice({ tone: "success", message: "Vorschaubild übernommen." });
    } finally {
      setImagePending(false);
    }
  }

  function imageFileFromClipboard(event: ClipboardEvent<HTMLElement>) {
    return Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
  }

  function imageFileFromDrop(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/"));
  }

  function triggerMetadataLoad() {
    if (metadataDebounceRef.current) clearTimeout(metadataDebounceRef.current);
    void loadMetadata(draftRef.current.url);
  }

  const metadataStatusLabel = metadataStatus === "loading"
    ? "Metadaten werden geladen"
    : metadataStatus === "success"
      ? "Metadaten geladen"
      : metadataStatus === "error"
        ? "Metadaten konnten nicht geladen werden"
        : "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={onSubmit} className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-2xl lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
          </div>
          <UiButton type="button" onClick={onClose} disabled={pending || imagePending} size="iconXs" className="text-slate-500" aria-label="Dialog schließen">
            <X size={16} />
          </UiButton>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <UiField>
            Name
            <UiTextInput
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
              inputSize="lg"
              inputPadding="md"
              required
              minLength={2}
              placeholder="z. B. Angebotsrechner"
            />
          </UiField>
          <UiField as="div">
            Kategorie
            <CustomSelect
              value={draft.category}
              onChange={(value) => patchDraft({ category: value as FmdTool["category"] })}
              className="h-10 text-sm"
              options={fmdToolCategoryOptions}
            />
          </UiField>
          <UiField>
            Owner
            <UiTextInput
              value={draft.owner}
              onChange={(event) => patchDraft({ owner: event.target.value })}
              inputSize="lg"
              inputPadding="md"
              placeholder={currentProfile?.name || "Team"}
            />
          </UiField>
          <UiField className="lg:col-span-2">
            Link
            <div className="relative">
              <UiTextInput
                value={draft.url}
                onChange={(event) => {
                  const url = event.target.value;
                  const currentDraft = draftRef.current;
                  lastLoadedMetadataUrlRef.current = "";
                  setMetadataStatus("idle");
                  patchDraft({
                    url,
                    isCurated: url.trim() ? currentDraft.isCurated : false,
                    previewImageUrl: currentDraft.previewImageSource === "og" ? "" : currentDraft.previewImageUrl,
                    previewImageSource: currentDraft.previewImageSource === "og" ? "none" : currentDraft.previewImageSource,
                  });
                }}
                inputSize="lg"
                inputPadding="md"
                type="url"
                onBlur={triggerMetadataLoad}
                placeholder="https://..."
                className="w-full pr-10"
              />
              <span
                className={classNames(
                  "pointer-events-none absolute right-3 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center",
                  metadataStatus === "success" && "text-emerald-600",
                  metadataStatus === "error" && "text-red-600",
                  metadataStatus === "loading" && "text-blue-600",
                )}
                aria-live="polite"
              >
                {metadataStatus === "loading" && <Loader2 size={16} className="animate-spin" />}
                {metadataStatus === "success" && <CheckCircle2 size={16} />}
                {metadataStatus === "error" && <XCircle size={16} />}
                {metadataStatusLabel && <span className="sr-only">{metadataStatusLabel}</span>}
              </span>
            </div>
          </UiField>
          <div className="grid gap-2 lg:col-span-2">
            <div
              tabIndex={0}
              onPaste={(event) => {
                const file = imageFileFromClipboard(event);
                if (!file) return;
                event.preventDefault();
                void handlePreviewFile(file);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                void handlePreviewFile(imageFileFromDrop(event));
              }}
              className={classNames(
                "grid gap-3 rounded-md border p-3 outline-none transition focus:ring-2 focus:ring-blue-100 sm:grid-cols-[128px_minmax(0,1fr)]",
                dragActive ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50/60",
              )}
            >
              <div className="grid h-24 w-32 place-items-center overflow-hidden rounded-md border border-slate-200 bg-white">
                {previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewImageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon size={24} className="text-slate-300" />
                )}
              </div>
              <div className="flex min-w-0 flex-col justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-700">Vorschaubild</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    Bild einfügen, hier ablegen oder hochladen. Manuelles Bild ersetzt Open-Graph.
                  </div>
                  {draft.previewImageSource !== "none" && (
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      Quelle: {draft.previewImageSource === "manual" ? "manuell" : "Open Graph"}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void handlePreviewFile(file);
                    }}
                  />
                  <UiButton
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={pending || imagePending}
                    size="sm"
                  >
                    {imagePending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    Bild hochladen
                  </UiButton>
                  {previewImageUrl && (
                    <UiButton
                      type="button"
                      onClick={() => patchDraft({ previewImageUrl: "", previewImageSource: "none" })}
                      disabled={pending || imagePending}
                      size="sm"
                      variant="ghost"
                      className="text-slate-500"
                    >
                      <Trash2 size={15} />
                      Entfernen
                    </UiButton>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <button
              type="button"
              role="switch"
              aria-checked={draft.isCurated}
              disabled={curateDisabled}
              onClick={() => patchDraft({ isCurated: !draft.isCurated })}
              className={classNames(
                "flex min-w-0 items-center justify-between gap-4 rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                draft.isCurated ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Link2 size={16} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">In kuratierte Links aufnehmen</span>
                  <span className="block text-xs text-slate-500">{curatedLinkCount}/{maxCuratedFmdToolLinks} belegt</span>
                </span>
              </span>
              <span className={classNames("relative h-5 w-9 rounded-full transition", draft.isCurated ? "bg-blue-600" : "bg-slate-200")}>
                <span className={classNames("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", draft.isCurated ? "left-4" : "left-0.5")} />
              </span>
            </button>
            {curatedWarning && <UiNotice tone="warning" size="compact">{curatedWarning}</UiNotice>}
          </div>
          <UiField className="lg:col-span-2">
            Beschreibung
            <UiTextArea
              value={draft.description}
              onChange={(event) => patchDraft({ description: event.target.value })}
              minHeight="md"
              inputPadding="mdBlock"
              required
              minLength={8}
              placeholder="Wofür wird der Link genutzt?"
            />
          </UiField>
        </div>

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 pb-4 pt-4 lg:-mx-5 lg:-mb-5 lg:px-5">
          <div className="min-h-8 min-w-0 flex-1">
            {dialogNotice && (
              <UiNotice tone={dialogNotice.tone} size="compact" className="inline-flex min-h-8 max-w-full items-center font-medium">
                {dialogNotice.message}
              </UiNotice>
            )}
          </div>
          <UiButton type="button" onClick={onClose} disabled={pending || imagePending} variant="secondary">Abbrechen</UiButton>
          <UiButton type="submit" variant="primary" disabled={pending || imagePending}>
            {mode === "edit" ? <Pencil size={16} /> : <Plus size={16} />}
            {pending ? "Speichert..." : submitLabel}
          </UiButton>
        </div>
      </form>
    </div>
  );
}
