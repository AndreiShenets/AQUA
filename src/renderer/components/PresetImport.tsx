import { DragEvent, useEffect, useRef, useState } from 'react';
import {
  MAX_PRESET_IMPORT_BYTES,
  MAX_PRESET_IMPORT_FILES,
  PresetImportResult,
} from 'common/presetImport';

interface IPresetImportProps {
  importPreset: (
    fileName: string,
    content: string
  ) => Promise<PresetImportResult>;
  onImported: (presetName: string) => void;
  isDisabled: boolean;
}

const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onabort = () => reject(new Error('File reading was cancelled.'));
    reader.readAsText(file);
  });

const PresetImport = ({
  importPreset,
  onImported,
  isDisabled,
}: IPresetImportProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [results, setResults] = useState<
    { fileName: string; message: string; failed: boolean }[]
  >([]);
  const busy = useRef(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    // Dropping elsewhere must not navigate Electron away from the application.
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  const importFiles = async (files: File[]) => {
    if (isDisabled || busy.current || files.length === 0) {
      return;
    }
    if (files.length > MAX_PRESET_IMPORT_FILES) {
      setResults([
        {
          fileName: '',
          message: `Drop at most ${MAX_PRESET_IMPORT_FILES} files at a time.`,
          failed: true,
        },
      ]);
      return;
    }
    busy.current = true;
    setIsImporting(true);
    setResults([]);
    try {
      for (const file of files) {
        let result: PresetImportResult;
        if (file.size > MAX_PRESET_IMPORT_BYTES) {
          result = { error: 'Preset files must be no larger than 256 KiB.' };
        } else {
          try {
            result = await importPreset(file.name, await readText(file));
          } catch {
            result = {
              error: 'Could not read or import the file. Please try again.',
            };
          }
        }
        if (result.presetName !== undefined) {
          onImported(result.presetName);
        }
        setResults((previous) => [
          ...previous,
          {
            fileName: file.name,
            message: result.error ?? `Imported as “${result.presetName}”.`,
            failed: result.error !== undefined,
          },
        ]);
      }
    } finally {
      busy.current = false;
      setIsImporting(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setIsDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The nested native file picker provides keyboard access to the same import action.
    <section
      className={`preset-import${isDragging ? ' dragging' : ''}`}
      aria-label="Preset import"
      aria-busy={isImporting}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          dragDepth.current += 1;
          if (!isDisabled && !busy.current) {
            setIsDragging(true);
          }
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setIsDragging(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect =
          isDisabled || isImporting ? 'none' : 'copy';
      }}
      onDrop={handleDrop}
    >
      <label>
        Drop AQUA preset files here, or choose files
        <input
          type="file"
          multiple
          aria-label="Import AQUA preset files"
          disabled={isDisabled || isImporting}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void importFiles(files);
          }}
        />
      </label>
      <output className="preset-import-results">
        {isImporting && <p>Importing presets…</p>}
        {results.length > 0 && (
          <ul>
            {results.map(({ fileName, message, failed }, index) => (
              <li
                key={`${index}-${fileName}`}
                className={failed ? 'import-error' : ''}
              >
                {fileName && <strong>{fileName}: </strong>}
                {message}
              </li>
            ))}
          </ul>
        )}
      </output>
    </section>
  );
};

export default PresetImport;
