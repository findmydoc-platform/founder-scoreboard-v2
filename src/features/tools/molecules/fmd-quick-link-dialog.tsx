"use client";

import { ImageIcon, Link2, Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, type FormEvent, useRef, useState } from "react";
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
  const [metadataPending, setMetadataPending] = useState(false);
  const [imagePending, setImagePending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [localNotice, setLocalNotice] = useState("");
  const title = mode === "edit" ? "Link bearbeiten" : "Link eintragen";
  const submitLabel = mode === "edit" ? "Speichern" : "Eintragen";
  const patchDraft = (patch: Partial<FmdToolDraft>) => {
    setLocalNotice("");
    onDraftChange({ ...draft, ...patch });
  };
  const linkPresent = Boolean(draft.url.trim());
  const curateDisabled = pending || (!draft.isCurated && (!linkPresent || curatedLimitReached));
  const previewImageUrl = draft.previewImageUrl.trim();
  const curatedWarning = linkPresent && curatedLimitReached && !draft.isCurated
      ? `Es sind bereits ${maxCuratedFmdToolLinks} kuratierte Links gesetzt.`
      : "";

  async function loadMetadata() {
    setMetadataPending(true);
    setLocalNotice("");
    try {
      const metadata = await onLoadMetadata(draft.url);
      if (!metadata) return;

      const nextDraft: FmdToolDraft = {
        ...draft,
        name: draft.name.trim() ? draft.name : metadata.title,
        description: draft.description.trim() ? draft.description : metadata.description,
      };

      if (metadata.imageUrl && draft.previewImageSource !== "manual" && !draft.previewImageUrl.trim()) {
        nextDraft.previewImageUrl = metadata.imageUrl;
        nextDraft.previewImageSource = "og";
      }

      onDraftChange(nextDraft);
      setLocalNotice("Metadaten übernommen.");
    } finally {
      setMetadataPending(false);
    }
  }

  async function handlePreviewFile(file: File | null | undefined) {
    if (!file || imagePending) return;
    setImagePending(true);
    setLocalNotice("");
    try {
      const uploaded = await onUploadPreviewImage(file);
      if (!uploaded) return;
      onDraftChange({
        ...draft,
        previewImageUrl: uploaded.imageUrl,
        previewImageSource: uploaded.source,
      });
      setLocalNotice("Vorschaubild übernommen.");
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
          <UiField>
            Link
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <UiTextInput
                value={draft.url}
                onChange={(event) => {
                  const url = event.target.value;
                  patchDraft({
                    url,
                    isCurated: url.trim() ? draft.isCurated : false,
                    previewImageUrl: draft.previewImageSource === "og" ? "" : draft.previewImageUrl,
                    previewImageSource: draft.previewImageSource === "og" ? "none" : draft.previewImageSource,
                  });
                }}
                inputSize="lg"
                inputPadding="md"
                type="url"
                placeholder="https://..."
              />
              <UiButton
                type="button"
                onClick={loadMetadata}
                disabled={pending || metadataPending || !linkPresent}
                variant="blueOutline"
                className="h-10"
              >
                {metadataPending ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                Metadaten laden
              </UiButton>
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
            {localNotice && <UiNotice tone="success" size="compact">{localNotice}</UiNotice>}
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

        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
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
