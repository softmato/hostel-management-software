/**
 * Universal uploader — the one way this app puts a file into storage.
 *
 * UI:      <FileUploader />          self-managed field (dropzone | button | compact)
 *          <FileUploaderView />      same field, driven by a useUploader instance
 * Hook:    useUploader()             headless: file list + upload + progress
 *          useIsUploading()          gate a submit button on any in-flight upload
 * Direct:  uploadFile/uploadFiles    imperative, from `@/lib/uploads/uploader`
 *
 * Progress for every one of these renders in the global <Toaster /> mounted in
 * the root layout — call sites never build their own progress UI.
 */
export {
  FileUploader,
  FileUploaderView,
  type FileUploaderPresentation,
  type FileUploaderProps,
  type UploaderTone,
} from "./file-uploader";
export {
  useIsUploading,
  useUploader,
  type UploadedAsset,
  type UploaderApi,
  type UseUploaderOptions,
} from "./use-uploader";
