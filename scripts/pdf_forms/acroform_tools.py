#!/usr/bin/env python3
from __future__ import annotations

import argparse
from io import BytesIO
import json
from collections import Counter
from pathlib import Path
from typing import Any

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (
        ArrayObject,
        DictionaryObject,
        FloatObject,
        NameObject,
        NumberObject,
        TextStringObject,
    )
except ModuleNotFoundError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "Missing dependency `pypdf`. Install it with "
        "`python3 -m pip install -r scripts/pdf_forms/requirements.txt`."
    ) from exc


FIELD_KIND_BY_ACRO_TYPE = {
    "/Btn": "button",
    "/Ch": "choice",
    "/Sig": "signature",
    "/Tx": "text",
}

ON_STRINGS = {"1", "checked", "on", "true", "yes", "y"}
OFF_STRINGS = {"", "0", "false", "no", "n", "off", "unchecked"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect, normalize, and fill AcroForm PDFs.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    inventory = subparsers.add_parser(
        "inventory",
        help="Export the leaf AcroForm field inventory to JSON.",
    )
    inventory.add_argument("--input", required=True, type=Path, help="Source PDF path.")
    inventory.add_argument("--output", required=True, type=Path, help="Output JSON path.")

    template = subparsers.add_parser(
        "template",
        help="Create a blank fill-value template for all leaf fields.",
    )
    template.add_argument("--input", required=True, type=Path, help="Source PDF path.")
    template.add_argument("--output", required=True, type=Path, help="Output JSON path.")

    normalize = subparsers.add_parser(
        "normalize",
        help="Write an AcroForm-only copy by stripping the XFA packet.",
    )
    normalize.add_argument("--input", required=True, type=Path, help="Source PDF path.")
    normalize.add_argument("--output", required=True, type=Path, help="Output PDF path.")
    normalize.add_argument(
        "--transform-spec",
        type=Path,
        help="Optional JSON spec for field transforms such as splitting fields.",
    )
    normalize.add_argument(
        "--strip-xfa",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Remove the XFA packet from the AcroForm dictionary.",
    )

    fill = subparsers.add_parser(
        "fill",
        help="Fill an AcroForm PDF from a JSON field-value mapping.",
    )
    fill.add_argument("--input", required=True, type=Path, help="Source PDF path.")
    fill.add_argument("--values", required=True, type=Path, help="Input values JSON path.")
    fill.add_argument("--output", required=True, type=Path, help="Output PDF path.")
    fill.add_argument(
        "--transform-spec",
        type=Path,
        help="Optional JSON spec for field transforms such as splitting fields.",
    )
    fill.add_argument(
        "--strip-xfa",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Remove the XFA packet so AcroForm values drive rendering.",
    )
    fill.add_argument(
        "--auto-regenerate",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Set the NeedAppearances flag while filling text fields.",
    )
    fill.add_argument(
        "--ignore-missing-fields",
        action="store_true",
        help="Ignore value keys that do not exist on the source PDF.",
    )

    return parser.parse_args()


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    ensure_parent(path)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def load_transform_spec(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_page_number_map(reader: PdfReader) -> dict[int, int]:
    page_number_by_id: dict[int, int] = {}
    for page_number, page in enumerate(reader.pages, start=1):
        page_ref = getattr(page, "indirect_reference", None)
        if page_ref is not None:
            page_number_by_id[page_ref.idnum] = page_number
    return page_number_by_id


def list_xfa_packets(reader: PdfReader) -> list[str]:
    root = reader.trailer["/Root"]
    acro_form = root.get("/AcroForm")
    if acro_form is None:
        return []
    acro_form_obj = acro_form.get_object()
    xfa = acro_form_obj.get("/XFA")
    if not isinstance(xfa, list):
        return []
    packets: list[str] = []
    for index in range(0, len(xfa), 2):
        packet_name = xfa[index]
        packets.append(str(packet_name))
    return packets


def get_leaf_fields(reader: PdfReader) -> list[dict[str, Any]]:
    all_fields = reader.get_fields() or {}
    page_number_by_id = build_page_number_map(reader)
    fields: list[dict[str, Any]] = []

    for full_name, field in all_fields.items():
        acro_type = field.get("/FT")
        if acro_type is None:
            continue

        field_object = field.indirect_reference.get_object()
        rect = field_object.get("/Rect")
        page_ref = field_object.raw_get("/P") if "/P" in field_object else None
        on_states = get_button_on_states(field_object)

        fields.append(
            {
                "fullName": full_name,
                "partialName": str(field_object.get("/T", "")),
                "fieldKind": FIELD_KIND_BY_ACRO_TYPE.get(str(acro_type), "unknown"),
                "acroType": str(acro_type),
                "page": page_number_by_id.get(getattr(page_ref, "idnum", -1)),
                "rect": [float(value) for value in rect] if rect else None,
                "flags": field_object.get("/Ff"),
                "maxLength": field_object.get("/MaxLen"),
                "defaultValue": pdf_scalar_to_json(field_object.get("/DV")),
                "currentValue": pdf_scalar_to_json(field_object.get("/V")),
                "buttonOnStates": on_states,
            }
        )

    fields.sort(
        key=lambda field: (
            field["page"] or 999,
            -(field["rect"][1] if field["rect"] else -1),
            field["rect"][0] if field["rect"] else 0,
            field["fullName"],
        )
    )
    return fields


def get_button_on_states(field_object: Any) -> list[str]:
    appearance = field_object.get("/AP")
    if appearance is None or "/N" not in appearance:
        return []
    normal_appearance = appearance["/N"]
    if not hasattr(normal_appearance, "keys"):
        return []
    return [str(key) for key in normal_appearance.keys() if str(key) != "/Off"]


def pdf_scalar_to_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def build_inventory_payload(source_pdf: Path) -> dict[str, Any]:
    reader = PdfReader(str(source_pdf))
    leaf_fields = get_leaf_fields(reader)
    counts_by_kind = Counter(field["fieldKind"] for field in leaf_fields)

    return {
        "sourcePdf": str(source_pdf),
        "pageCount": len(reader.pages),
        "hasAcroForm": reader.trailer["/Root"].get("/AcroForm") is not None,
        "hasXfa": bool(list_xfa_packets(reader)),
        "xfaPackets": list_xfa_packets(reader),
        "fieldCounts": {
            "leaf": len(leaf_fields),
            "byKind": dict(sorted(counts_by_kind.items())),
        },
        "fields": leaf_fields,
    }


def build_template_payload(source_pdf: Path) -> dict[str, Any]:
    inventory = build_inventory_payload(source_pdf)
    values: dict[str, Any] = {}
    for field in inventory["fields"]:
        if field["fieldKind"] == "button":
            values[field["fullName"]] = False
        else:
            values[field["fullName"]] = ""

    return {
        "sourcePdf": str(source_pdf),
        "stripXfaOnWrite": True,
        "values": values,
    }


def load_values_payload(path: Path) -> dict[str, Any]:
    raw_payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw_payload, dict) and isinstance(raw_payload.get("values"), dict):
        return dict(raw_payload["values"])
    if isinstance(raw_payload, dict):
        return dict(raw_payload)
    raise ValueError("Values JSON must be an object or an object with a `values` key.")


def normalize_pdf(
    source_pdf: Path,
    output_pdf: Path,
    *,
    strip_xfa: bool,
    transform_spec: dict[str, Any],
) -> None:
    writer = build_writer(source_pdf, strip_xfa=strip_xfa, transform_spec=transform_spec)
    ensure_parent(output_pdf)
    with output_pdf.open("wb") as file_obj:
        writer.write(file_obj)


def build_writer(
    source_pdf: Path,
    *,
    strip_xfa: bool,
    transform_spec: dict[str, Any],
) -> PdfWriter:
    reader = PdfReader(str(source_pdf))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    if strip_xfa:
        strip_xfa_packet(writer)
    if transform_spec:
        apply_transform_spec(writer, transform_spec)
    return writer


def strip_xfa_packet(writer: PdfWriter) -> None:
    acro_form = writer._root_object.get("/AcroForm")
    if acro_form is None:
        return
    acro_form_obj = acro_form.get_object()
    if "/XFA" in acro_form_obj:
        del acro_form_obj["/XFA"]


def apply_transform_spec(writer: PdfWriter, transform_spec: dict[str, Any]) -> None:
    split_text_fields = transform_spec.get("splitTextFields", [])
    if not split_text_fields:
        return

    max_struct_parent = get_max_struct_parent(writer)
    field_index = build_writer_field_index(writer)

    for split_spec in split_text_fields:
        max_struct_parent = split_text_field(
            writer,
            field_index,
            split_spec,
            start_struct_parent=max_struct_parent + 1,
        )


def get_max_struct_parent(writer: PdfWriter) -> int:
    max_struct_parent = -1
    for page in writer.pages:
        for annot_ref in page.get("/Annots", []):
            annot = annot_ref.get_object()
            struct_parent = annot.get("/StructParent")
            if struct_parent is not None:
                max_struct_parent = max(max_struct_parent, int(struct_parent))
    return max_struct_parent


def build_writer_field_index(writer: PdfWriter) -> dict[str, dict[str, Any]]:
    field_index: dict[str, dict[str, Any]] = {}
    for page in writer.pages:
        annots = page.get("/Annots", [])
        for annot_ref in annots:
            annot = annot_ref.get_object()
            if annot.get("/Subtype") != "/Widget":
                continue
            parent_annotation = annot
            if "/FT" not in annot or "/T" not in annot:
                parent_annotation = annot.get("/Parent", DictionaryObject()).get_object()
            full_name = writer._get_qualified_field_name(parent_annotation) or parent_annotation.get("/T")
            if full_name is None:
                continue
            field_index[str(full_name)] = {
                "annotation": annot,
                "annotationRef": annot_ref,
                "page": page,
            }
    return field_index


def split_text_field(
    writer: PdfWriter,
    field_index: dict[str, dict[str, Any]],
    split_spec: dict[str, Any],
    *,
    start_struct_parent: int,
) -> int:
    full_name = str(split_spec["fullName"])
    target = field_index.get(full_name)
    if target is None:
        raise ValueError(f"Split target field not found: {full_name}")

    annotation = target["annotation"]
    annotation_ref = target["annotationRef"]
    page = target["page"]
    if annotation.get("/FT") != "/Tx":
        raise ValueError(f"Split target must be a text field: {full_name}")

    parent_ref = annotation.raw_get("/Parent")
    parent_obj = parent_ref.get_object()
    parts = split_spec["parts"]
    if not isinstance(parts, list) or not parts:
        raise ValueError(f"Split target {full_name} must define at least one part.")

    rect = [float(value) for value in annotation.get("/Rect")]
    gap = float(split_spec.get("gap", 0))
    justify = int(split_spec.get("justify", annotation.get("/Q", 0) or 0))
    add_comb = bool(split_spec.get("comb", False))

    part_rects = split_rect_by_character_lengths(
        rect,
        [int(part["maxLength"]) for part in parts],
        gap=gap,
    )

    new_refs = []
    next_struct_parent = start_struct_parent
    for part, part_rect in zip(parts, part_rects):
        new_annotation = make_split_text_widget(
            source_annotation=annotation,
            parent_ref=parent_ref,
            partial_name=str(part["partialName"]),
            rect=part_rect,
            max_length=int(part["maxLength"]),
            justify=justify,
            struct_parent=next_struct_parent,
            comb=add_comb,
        )
        next_struct_parent += 1
        new_refs.append(writer._add_object(new_annotation))

    parent_obj[NameObject("/Kids")] = replace_reference_in_array(
        parent_obj["/Kids"],
        annotation_ref,
        new_refs,
    )
    page[NameObject("/Annots")] = replace_reference_in_array(
        page["/Annots"],
        annotation_ref,
        new_refs,
    )

    return next_struct_parent - 1


def split_rect_by_character_lengths(
    rect: list[float],
    character_lengths: list[int],
    *,
    gap: float,
) -> list[list[float]]:
    left, bottom, right, top = rect
    total_width = right - left
    total_gap = gap * (len(character_lengths) - 1)
    usable_width = total_width - total_gap
    if usable_width <= 0:
        raise ValueError(f"Invalid split geometry for rect {rect} with gap {gap}.")

    total_chars = sum(character_lengths)
    running_left = left
    part_rects: list[list[float]] = []
    for index, char_length in enumerate(character_lengths):
        part_width = usable_width * (char_length / total_chars)
        part_right = right if index == len(character_lengths) - 1 else running_left + part_width
        part_rects.append([running_left, bottom, part_right, top])
        running_left = part_right + gap
    return part_rects


def make_split_text_widget(
    *,
    source_annotation: DictionaryObject,
    parent_ref: Any,
    partial_name: str,
    rect: list[float],
    max_length: int,
    justify: int,
    struct_parent: int,
    comb: bool,
) -> DictionaryObject:
    do_not_spell_check_flag = 1 << 23
    comb_flag = 1 << 24
    field_flags = do_not_spell_check_flag | (comb_flag if comb else 0)

    widget = DictionaryObject()
    widget[NameObject("/Type")] = NameObject("/Annot")
    widget[NameObject("/Subtype")] = NameObject("/Widget")
    widget[NameObject("/FT")] = NameObject("/Tx")
    widget[NameObject("/T")] = TextStringObject(partial_name)
    widget[NameObject("/Parent")] = parent_ref
    widget[NameObject("/P")] = source_annotation.raw_get("/P")
    widget[NameObject("/Rect")] = ArrayObject(FloatObject(value) for value in rect)
    widget[NameObject("/F")] = NumberObject(int(source_annotation.get("/F", 4)))
    widget[NameObject("/Q")] = NumberObject(justify)
    widget[NameObject("/DA")] = TextStringObject(str(source_annotation.get("/DA")))
    widget[NameObject("/MK")] = DictionaryObject()
    widget[NameObject("/Ff")] = NumberObject(field_flags)
    widget[NameObject("/MaxLen")] = NumberObject(max_length)
    widget[NameObject("/StructParent")] = NumberObject(struct_parent)
    return widget


def replace_reference_in_array(
    original_array: ArrayObject,
    target_ref: Any,
    replacement_refs: list[Any],
) -> ArrayObject:
    replaced = ArrayObject()
    for ref in original_array:
        if getattr(ref, "idnum", None) == getattr(target_ref, "idnum", None):
            for replacement_ref in replacement_refs:
                replaced.append(replacement_ref)
        else:
            replaced.append(ref)
    return replaced


def fill_pdf(
    source_pdf: Path,
    values_path: Path,
    output_pdf: Path,
    *,
    strip_xfa: bool,
    transform_spec: dict[str, Any],
    auto_regenerate: bool,
    ignore_missing_fields: bool,
) -> None:
    inventory = build_inventory_payload_for_working_copy(
        source_pdf,
        strip_xfa=strip_xfa,
        transform_spec=transform_spec,
    )
    field_by_name = {field["fullName"]: field for field in inventory["fields"]}
    raw_values = load_values_payload(values_path)

    missing_fields = sorted(name for name in raw_values if name not in field_by_name)
    if missing_fields and not ignore_missing_fields:
        missing_preview = ", ".join(missing_fields[:10])
        raise ValueError(
            "Values file contains unknown field names: "
            f"{missing_preview}"
            + ("..." if len(missing_fields) > 10 else "")
        )

    normalized_values: dict[str, str] = {}
    for field_name, raw_value in raw_values.items():
        field_meta = field_by_name.get(field_name)
        if field_meta is None:
            continue
        if field_meta["fieldKind"] == "button":
            normalized_values[field_name] = normalize_button_value(
                raw_value,
                field_meta["buttonOnStates"],
            )
        else:
            normalized_values[field_name] = "" if raw_value is None else str(raw_value)

    writer = build_writer(
        source_pdf,
        strip_xfa=strip_xfa,
        transform_spec=transform_spec,
    )
    if normalized_values:
        writer.update_page_form_field_values(
            None,
            normalized_values,
            auto_regenerate=auto_regenerate,
        )

    ensure_parent(output_pdf)
    with output_pdf.open("wb") as file_obj:
        writer.write(file_obj)


def build_inventory_payload_for_working_copy(
    source_pdf: Path,
    *,
    strip_xfa: bool,
    transform_spec: dict[str, Any],
) -> dict[str, Any]:
    writer = build_writer(
        source_pdf,
        strip_xfa=strip_xfa,
        transform_spec=transform_spec,
    )
    output = BytesIO()
    writer.write(output)
    output.seek(0)
    reader = PdfReader(output)
    leaf_fields = get_leaf_fields(reader)
    counts_by_kind = Counter(field["fieldKind"] for field in leaf_fields)
    return {
        "sourcePdf": str(source_pdf),
        "pageCount": len(reader.pages),
        "hasAcroForm": reader.trailer["/Root"].get("/AcroForm") is not None,
        "hasXfa": bool(list_xfa_packets(reader)),
        "xfaPackets": list_xfa_packets(reader),
        "fieldCounts": {
            "leaf": len(leaf_fields),
            "byKind": dict(sorted(counts_by_kind.items())),
        },
        "fields": leaf_fields,
    }


def normalize_button_value(raw_value: Any, on_states: list[str]) -> str:
    if raw_value is None:
        return "/Off"

    default_on_state = on_states[0] if on_states else "/Yes"

    if isinstance(raw_value, bool):
        return default_on_state if raw_value else "/Off"

    if isinstance(raw_value, (int, float)):
        if raw_value == 0:
            return "/Off"
        if float(raw_value).is_integer() and int(raw_value) == 1:
            return default_on_state
        candidate = f"/{int(raw_value)}" if float(raw_value).is_integer() else f"/{raw_value}"
        if on_states and candidate not in on_states:
            raise ValueError(
                f"Button value {raw_value!r} does not match any allowed states {on_states}."
            )
        return candidate if on_states else default_on_state

    if not isinstance(raw_value, str):
        raise TypeError(
            f"Unsupported button value type {type(raw_value).__name__}; "
            "use a boolean or a string like '/1' or 'off'."
        )

    normalized = raw_value.strip()
    lowered = normalized.lower()
    if lowered in OFF_STRINGS:
        return "/Off"
    if lowered in ON_STRINGS:
        return default_on_state

    candidate = normalized if normalized.startswith("/") else f"/{normalized}"
    if on_states and candidate not in on_states and candidate != "/Off":
        raise ValueError(
            f"Button value {raw_value!r} does not match any allowed states {on_states}."
        )
    return candidate


def main() -> int:
    args = parse_args()

    if args.command == "inventory":
        write_json(args.output, build_inventory_payload(args.input))
        return 0

    if args.command == "template":
        write_json(args.output, build_template_payload(args.input))
        return 0

    if args.command == "normalize":
        normalize_pdf(
            args.input,
            args.output,
            strip_xfa=args.strip_xfa,
            transform_spec=load_transform_spec(args.transform_spec),
        )
        return 0

    if args.command == "fill":
        fill_pdf(
            args.input,
            args.values,
            args.output,
            strip_xfa=args.strip_xfa,
            transform_spec=load_transform_spec(args.transform_spec),
            auto_regenerate=args.auto_regenerate,
            ignore_missing_fields=args.ignore_missing_fields,
        )
        return 0

    raise AssertionError(f"Unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
