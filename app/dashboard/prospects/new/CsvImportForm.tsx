"use client";

import { useActionState } from "react";
import { importCsv, type ImportCsvState } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

const initialState: ImportCsvState = { error: null, summary: null };

export function CsvImportForm() {
  const [state, formAction, pending] = useActionState(importCsv, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block text-text-secondary">Archivo CSV</span>
        <input
          type="file"
          name="csv_file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-accent-450 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
        />
      </label>
      <p className="text-xs text-text-muted">
        Columnas reconocidas (en cualquier idioma/orden): nombre*, categoria, sector, direccion,
        ciudad, region, codigo_postal, pais, telefono, web, email, rating, num_resenas, lat, lng,
        place_id. Solo <em>nombre</em> es obligatorio. Máx. {2}MB / 2000 filas.
      </p>

      {state.error && <p className="text-sm text-status-critical">{state.error}</p>}
      {state.summary && (
        <div className="rounded-lg border border-border-hairline bg-surface-2 p-3 text-sm">
          <p>
            <strong>{state.summary.inserted}</strong> negocios importados,{" "}
            <strong>{state.summary.duplicates}</strong> duplicados omitidos
            {state.summary.errorRows > 0 && (
              <>
                , <strong className="text-status-critical">{state.summary.errorRows}</strong> filas con errores
              </>
            )}
            .
          </p>
        </div>
      )}

      <button type="submit" disabled={pending} className={buttonVariants()}>
        {pending ? "Importando..." : "Importar CSV"}
      </button>
    </form>
  );
}
