import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import type { PhotoInfo } from './useScanFlow';

interface Props {
  photo: PhotoInfo;
  /** True while OCR is running. */
  processing: boolean;
  onRead: () => void;
  onRetake: () => void;
  onCancel: () => void;
}

/** The photo being processed, with Read Serial / Retake / Cancel. Nothing is registered here. */
export function PhotoPreview({ photo, processing, onRead, onRetake, onCancel }: Props) {
  return (
    <section aria-labelledby="preview-title" className="space-y-4">
      <h2 id="preview-title" className="text-lg font-bold">
        {processing ? 'Reading serial…' : 'Check your photo'}
      </h2>
      <figure className="relative overflow-hidden rounded-lg border border-line bg-surface p-2">
        <img
          src={photo.url}
          alt="Photo of the serial being read"
          className="max-h-96 w-full rounded object-contain"
        />
        {/* Same guide box over the preview, so the operator can judge the framing. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[34%] -translate-y-1/2 rounded border-2 border-dashed border-action"
        />
        <figcaption className="mt-2 text-sm text-ink-muted">
          Is the serial sharp, inside the box, and free of glare? If not, retake the photo.
        </figcaption>
      </figure>

      {processing ? (
        <>
          <LoadingState label="Reading the serial from the photo…" />
          <Button variant="secondary" onClick={onCancel} className="min-h-14 w-full text-lg">
            Cancel
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <Button onClick={onRead} className="min-h-16 w-full text-xl">
            Read Serial
          </Button>
          <Button variant="secondary" onClick={onRetake} className="min-h-14 w-full text-lg">
            Retake Photo
          </Button>
          <Button variant="secondary" onClick={onCancel} className="min-h-14 w-full text-lg">
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}
