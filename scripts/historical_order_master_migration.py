#!/usr/bin/env python3
"""Build a local-only, reproducible historical-order migration manifest.

The XLSX package is read with Python's standard library only: ZIP members,
shared strings, worksheet XML and drawing XML metadata. No media member is
opened, no image bytes are decoded, and no remote or database client is
imported.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

EXPECTED_SOURCE_SHA256 = "c7d0ae7a7169337ed8929f59e7cb78beac4e57be098a5f086970446e6269b937"
EXPECTED_HEADERS = [
    "下单日期", "更新状态", "客户编号", "买家微信", "店铺名字", "ASIN",
    "订单价格", "聊天截图", "订单截图", "订单号", "到货图", "提交评论日期",
    "通过日期", "评论通过截图", "补fb日期", "补fb截图", "评论状态", "订单详情",
    "评论链接", "返款状态", "返款汇率", "返款时间", "返款截图", "服务费金额",
    "卖家返金汇率", "结算日期", "买家返金金额", "卖家返金金额", "汇率差", "利润",
]
IMAGE_COLUMNS = {7, 8, 10, 13, 15, 22}

AMAZON_ORDER_PATTERN = r"\d{3}-\d{7}-\d{7}"
RAKUTEN_ORDER_PATTERN = r"\d{6}-\d{8}-\d{10}"
AMAZON_MISSING_SEPARATOR_PATTERN = r"\d{3}-\d{14}"
TIKTOK_ORDER_PATTERN = r"585\d{15}"
LOCAL_ONLY_MARKETPLACE_BLOCKERS = {
    "JP_RAKUTEN": "MARKETPLACE_REGISTRY_UNSUPPORTED_JP_RAKUTEN",
    "JP_TIKTOK": "MARKETPLACE_REGISTRY_UNSUPPORTED_JP_TIKTOK",
}

SELLER_REFUNDED_BUYER_PENDING_ORDERS = {
    "503-0986403-7271869", "250-4547088-4943810", "503-1835796-4474265",
    "249-9375479-7574217", "503-5939995-8151030", "250-1195932-3215057",
    "503-0516076-5903006", "250-1251706-3526254", "503-9393547-9126245",
    "249-9342177-7392614",
}
BOTH_REFUNDED_ORDERS = {
    "249-3030018-6873412", "503-2517749-3412641", "249-2321209-3779069",
    "249-0494212-1125404", "250-8593294-9280643", "503-7301326-3339803",
    "250-5246509-1203846", "503-6111671-6930204", "503-4306470-9486249",
    "249-7556022-3143027", "249-1751539-8287016", "503-3653578-4115064",
    "249-7035216-3683026", "250-0039053-2018244", "249-8810954-9143805",
    "250-8501713-5647024", "249-3555018-2505446", "503-6073358-2403025",
    "503-3311488-2387805", "249-3113530-9425425", "250-2082014-3646253",
    "249-7846775-7131011", "250-4177678-3253408", "503-1667041-7143801",
    "503-3701481-4308655", "503-6467355-2548602", "503-0300896-5582241",
    "503-1920056-3093404", "250-7004765-7420611", "503-1326458-0543805",
    "249-4953067-2898261", "249-5249838-1525446", "249-0329922-8553416",
    "503-2817535-9667831", "249-1039022-6103854", "249-1111486-0670249",
    "249-6813435-4514250", "249-0494067-6532615", "250-9606204-1591032",
    "249-3530793-4126221",
}


class DryRunError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(unicodedata.normalize("NFKC", str(value)).split()).strip()


def compact_status(value: Any) -> str:
    return clean_text(value).replace(" ", "")


def parse_source_date(value: Any) -> str | None:
    if isinstance(value, (dt.datetime, dt.date)):
        return value.date().isoformat() if isinstance(value, dt.datetime) else value.isoformat()
    text = clean_text(value)
    match = re.fullmatch(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", text)
    if not match:
        return None
    try:
        return dt.date(*(int(part) for part in match.groups())).isoformat()
    except ValueError:
        return None


def normalized_order_number(value: Any) -> str:
    return clean_text(value).replace(" ", "")


def normalized_product_identifier(value: Any) -> str:
    return clean_text(value).upper().replace(" ", "")


def classify_order_identifier(value: Any) -> dict[str, Any]:
    raw_identifier = normalized_order_number(value)
    if not raw_identifier:
        return {
            "raw_platform_order_identifier": raw_identifier,
            "platform_order_identifier": None,
            "marketplace_code": None,
            "validation_status": "INVALID",
            "basis": "MISSING_ORDER_NUMBER",
        }
    if re.fullmatch(AMAZON_ORDER_PATTERN, raw_identifier):
        return {
            "raw_platform_order_identifier": raw_identifier,
            "platform_order_identifier": raw_identifier,
            "marketplace_code": "JP_AMAZON",
            "validation_status": "VALID",
            "basis": "RAW_AMAZON_ORDER_SHAPE",
        }
    if re.fullmatch(RAKUTEN_ORDER_PATTERN, raw_identifier):
        return {
            "raw_platform_order_identifier": raw_identifier,
            "platform_order_identifier": raw_identifier,
            "marketplace_code": "JP_RAKUTEN",
            "validation_status": "VALID",
            "basis": "OWNER_RULE_RAKUTEN_ORDER_SHAPE",
        }
    if re.fullmatch(AMAZON_MISSING_SEPARATOR_PATTERN, raw_identifier):
        normalized = f"{raw_identifier[:3]}-{raw_identifier[4:11]}-{raw_identifier[11:]}"
        return {
            "raw_platform_order_identifier": raw_identifier,
            "platform_order_identifier": normalized,
            "marketplace_code": "JP_AMAZON",
            "validation_status": "VALID_WITH_NORMALIZATION",
            "basis": "NORMALIZED_MISSING_SEPARATOR",
        }
    if re.fullmatch(TIKTOK_ORDER_PATTERN, raw_identifier):
        return {
            "raw_platform_order_identifier": raw_identifier,
            "platform_order_identifier": raw_identifier,
            "marketplace_code": "JP_TIKTOK",
            "validation_status": "VALID_LOCAL_SCHEMA_CANDIDATE",
            "basis": "OWNER_RULE_TIKTOK_585_PREFIX_18_DIGIT_ORDER_SHAPE",
        }
    return {
        "raw_platform_order_identifier": raw_identifier,
        "platform_order_identifier": None,
        "marketplace_code": None,
        "validation_status": "INVALID",
        "basis": "UNRECOGNIZED_ORDER_SHAPE",
    }


def classify_product_identifier(value: Any, marketplace_code: str | None) -> dict[str, Any]:
    raw_identifier = clean_text(value)
    identifier = normalized_product_identifier(value)
    if marketplace_code == "JP_TIKTOK" and not identifier:
        return {
            "product_key": "JP_TIKTOK:TIKTOKDLP2555Q",
            "marketplace_code": "JP_TIKTOK",
            "platform_product_identifier": "TIKTOKDLP2555Q",
            "raw_platform_product_identifier": raw_identifier,
            "manual_platform_product_identifier": "tiktokDLP2555Q",
            "validation_status": "VALID_OWNER_OVERRIDE",
            "basis": "OWNER_OVERRIDE_MISSING_PRODUCT_IDENTIFIER",
            "owner_override_provenance": {"provenance": "OWNER_CONFIRMED", "raw_source_value": raw_identifier, "owner_value": "tiktokDLP2555Q", "canonical_value": "TIKTOKDLP2555Q", "seller_organization_key": "ygbceping:ls381048211", "store_name": "Philips"},
        }
    if not identifier:
        return {"product_key": None, "marketplace_code": marketplace_code, "platform_product_identifier": None, "raw_platform_product_identifier": raw_identifier, "manual_platform_product_identifier": None, "validation_status": "INVALID", "basis": "MISSING_PRODUCT_IDENTIFIER", "owner_override_provenance": None}
    if marketplace_code == "JP_RAKUTEN":
        return {"product_key": f"JP_RAKUTEN:{identifier}", "marketplace_code": "JP_RAKUTEN", "platform_product_identifier": identifier, "raw_platform_product_identifier": raw_identifier, "manual_platform_product_identifier": None, "validation_status": "VALID", "basis": "ORDER_MARKETPLACE_RULE_RAKUTEN_PRODUCT_IDENTIFIER", "owner_override_provenance": None}
    if marketplace_code == "JP_TIKTOK":
        return {"product_key": f"JP_TIKTOK:{identifier}", "marketplace_code": "JP_TIKTOK", "platform_product_identifier": identifier, "raw_platform_product_identifier": raw_identifier, "manual_platform_product_identifier": raw_identifier or None, "validation_status": "VALID_LOCAL_SCHEMA_CANDIDATE", "basis": "ORDER_MARKETPLACE_RULE_TIKTOK_PRODUCT_IDENTIFIER", "owner_override_provenance": None}
    if identifier in {"R-1", "S-1"}:
        return {"product_key": f"JP_RAKUTEN:{identifier}", "marketplace_code": "JP_RAKUTEN", "platform_product_identifier": identifier, "raw_platform_product_identifier": raw_identifier, "manual_platform_product_identifier": None, "validation_status": "VALID", "basis": "EXPLICIT_RAKUTEN_PRODUCT_IDENTIFIER", "owner_override_provenance": None}
    if re.fullmatch(r"[A-Z0-9]{10}", identifier):
        return {"product_key": f"JP_AMAZON:{identifier}", "marketplace_code": "JP_AMAZON", "platform_product_identifier": identifier, "raw_platform_product_identifier": raw_identifier, "manual_platform_product_identifier": None, "validation_status": "VALID", "basis": "EXPLICIT_AMAZON_ASIN", "owner_override_provenance": None}
    return {"product_key": None, "marketplace_code": marketplace_code, "platform_product_identifier": identifier, "raw_platform_product_identifier": raw_identifier, "manual_platform_product_identifier": None, "validation_status": "INVALID", "basis": "INVALID_PRODUCT_IDENTIFIER_FOR_MARKETPLACE", "owner_override_provenance": None}


def marketplace_registry_blocker(marketplace_code: str | None) -> str | None:
    return LOCAL_ONLY_MARKETPLACE_BLOCKERS.get(marketplace_code or "")


def product_schema_status(marketplace_code: str | None) -> str:
    return "LOCAL_CANONICAL_CANDIDATE_REGISTRY_UNSUPPORTED" if marketplace_registry_blocker(marketplace_code) else "CURRENT_MARKETPLACE_SHAPE"


def duplicate_group_key(order_number_key: str | None, duplicate_group_size: int | None) -> str | None:
    return order_number_key if order_number_key and duplicate_group_size is not None and duplicate_group_size > 1 else None


def platform_evidence(product: dict[str, Any], order: dict[str, Any]) -> dict[str, str]:
    product_evidence = product["basis"]
    order_evidence = order["basis"]
    marketplace = order["marketplace_code"]
    if marketplace == "JP_TIKTOK":
        conclusion = "TIKTOK_ORDER_SHAPE_CONFIRMED_PRODUCT_SCHEMA_LOCAL_CANDIDATE"
    elif marketplace == "JP_RAKUTEN":
        conclusion = "RAKUTEN_ORDER_SHAPE_CONFIRMED_PRODUCT_IDENTIFIER_MARKETPLACE_AWARE"
    elif marketplace == "JP_AMAZON":
        conclusion = "AMAZON_ORDER_SHAPE_CONFIRMED"
    elif product["product_key"]:
        conclusion = "PRODUCT_PLATFORM_EVIDENCE_ORDER_SHAPE_UNPROVEN"
    else:
        conclusion = "NO_AUTHORITATIVE_PLATFORM_CONCLUSION"
    return {
        "product_evidence": product_evidence,
        "order_identifier_evidence": order_evidence,
        "marketplace_code": marketplace or "UNRESOLVED",
        "conclusion": conclusion,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def anonymized_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def classify_refund_status(
    raw_value: Any,
    *,
    order_number: str,
    order_date: str | None,
    has_refund_date: bool,
    has_refund_screenshot: bool,
) -> dict[str, str]:
    status = compact_status(raw_value)
    if order_number in SELLER_REFUNDED_BUYER_PENDING_ORDERS:
        return {"buyer": "PENDING", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "EXPLICIT_ORDER_OVERRIDE"}
    if order_number in BOTH_REFUNDED_ORDERS:
        return {"buyer": "REFUNDED", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "EXPLICIT_ORDER_OVERRIDE"}
    if status == "已返款":
        return {"buyer": "REFUNDED", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "RAW_STATUS"}
    if status in {"取消订单", "订单取消"}:
        return {"buyer": "NOT_APPLICABLE", "seller": "NOT_APPLICABLE", "mapping": "MAPPED", "lifecycle": "CANCELLED", "basis": "RAW_STATUS"}
    if status == "自费":
        return {"buyer": "NOT_APPLICABLE", "seller": "NOT_APPLICABLE", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "RAW_STATUS"}
    if status.endswith("催评"):
        return {"buyer": "PENDING", "seller": "PENDING", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE"}
    if status in {"返款70%等联系评论", "店铺原因无法评论先返款本金"}:
        return {"buyer": "REFUNDED", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE"}
    evidence = has_refund_date and has_refund_screenshot
    if "待返款" in status and "卖家未返款" in status:
        return {"buyer": "REFUNDED" if evidence else "PENDING", "seller": "PENDING", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "DATE_AND_SCREENSHOT" if evidence else "RAW_STATUS"}
    if status in {"8-7-待返款", "8-7待返款"}:
        return {"buyer": "REFUNDED" if evidence else "PENDING", "seller": "PENDING", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "DATE_AND_SCREENSHOT" if evidence else "RAW_STATUS"}
    if status == "卖家不返款":
        return {"buyer": "REFUNDED", "seller": "WAIVED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "RAW_STATUS"}
    if status.endswith("待返款"):
        return {"buyer": "REFUNDED" if evidence else "PENDING", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "DATE_AND_SCREENSHOT" if evidence else "RAW_STATUS"}
    if not status and order_date is not None:
        if order_date < "2026-01-01":
            return {"buyer": "REFUNDED", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE_DATE_CUTOFF"}
        return {"buyer": "PENDING", "seller": "PENDING", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE_DATE_CUTOFF"}
    if not status:
        return {"buyer": "UNKNOWN", "seller": "UNKNOWN", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE_DATE_CUTOFF_UNRESOLVED_DATE"}
    return {"buyer": "UNKNOWN", "seller": "UNKNOWN", "mapping": "UNMAPPED", "lifecycle": "UNKNOWN", "basis": "UNMAPPED_STATUS"}


def scan_drawing(path: Path) -> dict[str, Any]:
    spreadsheet_ns = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
    drawing_ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    package_rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    drawing_path = "xl/drawings/drawing1.xml"
    relationship_path = "xl/drawings/_rels/drawing1.xml.rels"
    labels = {7: "H_聊天截图", 8: "I_订单截图", 10: "K_到货图_忽略", 13: "N_评论通过截图", 15: "P_补fb截图", 22: "W_返款截图"}
    counts: collections.Counter[int] = collections.Counter()
    rows: dict[int, list[int]] = collections.defaultdict(list)
    rel_ids: list[str] = []
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise DryRunError("INVALID_XLSX_PACKAGE", f"cannot open XLSX ZIP package: {exc}") from exc
    with archive:
        media = [info for info in archive.infolist() if info.filename.startswith("xl/drawings/media/") and not info.is_dir()]
        relationships: dict[str, str] = {}
        if relationship_path in archive.namelist():
            root = ET.fromstring(archive.read(relationship_path))
            relationships = {node.attrib["Id"]: node.attrib["Target"] for node in root.findall(f"{{{package_rel_ns}}}Relationship")}
        if drawing_path not in archive.namelist():
            return {"image_count": 0, "media_file_count": len(media), "columns": {}, "missing_relationship_ids": []}
        with archive.open(drawing_path) as drawing:
            for _, element in ET.iterparse(drawing, events=("end",)):
                if element.tag not in {f"{{{spreadsheet_ns}}}oneCellAnchor", f"{{{spreadsheet_ns}}}twoCellAnchor"}:
                    continue
                start = element.find(f"{{{spreadsheet_ns}}}from")
                column_node = start.find(f"{{{spreadsheet_ns}}}col") if start is not None else None
                row_node = start.find(f"{{{spreadsheet_ns}}}row") if start is not None else None
                blip = element.find(f".//{{{drawing_ns}}}blip")
                if column_node is not None and row_node is not None and blip is not None:
                    column = int(column_node.text or "-1")
                    row = int(row_node.text or "-1") + 1
                    rel_id = blip.attrib.get(f"{{{rel_ns}}}embed", "")
                    counts[column] += 1
                    rows[column].append(row)
                    rel_ids.append(rel_id)
                element.clear()
    return {
        "image_count": len(rel_ids),
        "media_file_count": len(media),
        "relationship_count": len(relationships),
        "missing_relationship_ids": sorted({value for value in rel_ids if value not in relationships}),
        "columns": {
            labels.get(column, f"COLUMN_ZERO_BASED_{column}"): {
                "image_count": count,
                "unique_row_count": len(set(rows[column])),
                "row_numbers": sorted(set(rows[column])),
                "image_count_by_row": {
                    str(row): row_count
                    for row, row_count in sorted(collections.Counter(rows[column]).items())
                },
                "rows_with_multiple_images": sorted(row for row, row_count in collections.Counter(rows[column]).items() if row_count > 1),
            }
            for column, count in sorted(counts.items())
        },
    }


def load_current_mapping(mapping_dir: Path) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
    mapping: dict[str, dict[str, Any]] = {}
    references: list[dict[str, str]] = []
    for path in sorted(mapping_dir.glob("full-readonly-product-table-*.md")):
        references.append({"path": str(path), "sha256": sha256_file(path)})
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.startswith("| JP_"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) != 5:
                continue
            key, identifier, current_rows, status, sellers = cells
            seller_keys = [] if sellers == "—" else [value.strip() for value in sellers.split("<br>") if value.strip()]
            mapping[key] = {
                "product_key": key,
                "platform_product_identifier": identifier,
                "current_rows": current_rows,
                "status": status,
                "seller_organization_keys": seller_keys,
            }
    if not mapping:
        raise DryRunError("MAPPING_EVIDENCE_EMPTY", f"current product mapping evidence is empty: {mapping_dir}")
    return mapping, references


def mapping_category(key: str | None, mapping: dict[str, dict[str, Any]]) -> str:
    if key is None or key not in mapping:
        if key == "JP_TIKTOK:TIKTOKDLP2555Q":
            return "OWNER_CONFIRMED_TIKTOK_PRODUCT_STORE_SELLER"
        if key and key.startswith("JP_TIKTOK:"):
            return "UNSUPPORTED_TIKTOK_MARKETPLACE_LOCAL_CANDIDATE"
        return "NO_CURRENT_PRODUCT_MATCH"
    item = mapping[key]
    sellers = item["seller_organization_keys"]
    if item["status"] != "MAPPED" or not sellers:
        return "CURRENT_PRODUCT_SELLER_UNRESOLVED"
    if len(sellers) == 1:
        return "CURRENT_PRODUCT_SINGLE_SELLER_CANDIDATE"
    return "CURRENT_PRODUCT_MULTI_SELLER_AMBIGUOUS"


def source_reasons(
    values: list[Any],
    refund: dict[str, str],
    order: dict[str, Any],
    product: dict[str, Any],
    exact_duplicate: bool,
) -> list[str]:
    reasons: list[str] = []
    if parse_source_date(values[0]) is None:
        reasons.append("MISSING_OR_INVALID_ORDER_DATE")
    if not clean_text(values[2]):
        reasons.append("MISSING_CUSTOMER_NUMBER")
    if not clean_text(values[4]):
        reasons.append("MISSING_STORE_NAME")
    if product["validation_status"] == "INVALID":
        reasons.append(product["basis"])
    if order["validation_status"] == "INVALID":
        reasons.append(order["basis"])
    if refund["mapping"] == "UNMAPPED":
        reasons.append("UNMAPPED_REFUND_STATUS")
    if exact_duplicate:
        reasons.append("EXACT_DUPLICATE_SOURCE_FACTS")
    return sorted(set(reasons))


def row_signature(values: list[Any]) -> str:
    return json.dumps([clean_text(values[index]) for index in range(30) if index not in IMAGE_COLUMNS], ensure_ascii=False, separators=(",", ":"))


def column_number(cell_reference: str) -> int:
    letters = re.match(r"[A-Z]+", cell_reference.upper())
    if not letters:
        raise DryRunError("INVALID_CELL_REFERENCE", f"invalid cell reference: {cell_reference}")
    number = 0
    for letter in letters.group(0):
        number = number * 26 + ord(letter) - ord("A") + 1
    return number


def column_letters(column_number_value: int) -> str:
    letters = ""
    value = column_number_value
    while value:
        value, remainder = divmod(value - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def load_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    shared_path = "xl/sharedStrings.xml"
    if shared_path not in archive.namelist():
        return []
    values: list[str] = []
    try:
        with archive.open(shared_path) as source:
            for _, element in ET.iterparse(source, events=("end",)):
                if local_name(element.tag) != "si":
                    continue
                values.append("".join(node.text or "" for node in element.iter() if local_name(node.tag) == "t"))
                element.clear()
    except ET.ParseError as exc:
        raise DryRunError("INVALID_SHARED_STRINGS", f"cannot parse shared strings: {exc}") from exc
    return values


def resolve_sheet_path(archive: zipfile.ZipFile, sheet_name: str) -> str:
    workbook_path = "xl/workbook.xml"
    relationships_path = "xl/_rels/workbook.xml.rels"
    if workbook_path not in archive.namelist() or relationships_path not in archive.namelist():
        raise DryRunError("INVALID_XLSX_PACKAGE", "workbook.xml or workbook relationships are missing")
    namespace = {
        "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "package": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    try:
        workbook = ET.fromstring(archive.read(workbook_path))
        relationships = ET.fromstring(archive.read(relationships_path))
    except ET.ParseError as exc:
        raise DryRunError("INVALID_WORKBOOK_XML", f"cannot parse workbook metadata: {exc}") from exc
    relationship_targets = {
        node.attrib["Id"]: node.attrib["Target"]
        for node in relationships.findall("package:Relationship", namespace)
    }
    for sheet in workbook.findall("main:sheets/main:sheet", namespace):
        if sheet.attrib.get("name") != sheet_name:
            continue
        relationship_id = sheet.attrib.get(f"{{{namespace['rel']}}}id")
        target = relationship_targets.get(relationship_id or "")
        if not target:
            raise DryRunError("SOURCE_SHEET_RELATIONSHIP_MISSING", f"worksheet relationship is missing: {sheet_name}")
        return str(Path("xl") / target).replace("\\", "/")
    raise DryRunError("SOURCE_SHEET_MISSING", f"source worksheet is missing: {sheet_name}")


def cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    value_node = next((node for node in cell if local_name(node.tag) == "v"), None)
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter() if local_name(node.tag) == "t")
    if value_node is None or value_node.text is None:
        return None
    value = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(value)]
        except (IndexError, ValueError) as exc:
            raise DryRunError("SHARED_STRING_INDEX_INVALID", f"invalid shared string index: {value}") from exc
    if cell_type == "b":
        return value == "1"
    if cell_type in {"str", "e"}:
        return value
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    try:
        return float(value)
    except ValueError:
        return value


def iter_source_rows(path: Path) -> Iterable[tuple[int, list[Any]]]:
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise DryRunError("INVALID_XLSX_PACKAGE", f"cannot open XLSX ZIP package: {exc}") from exc
    with archive:
        shared_strings = load_shared_strings(archive)
        sheet_path = resolve_sheet_path(archive, "数据母表")
        if sheet_path not in archive.namelist():
            raise DryRunError("SOURCE_SHEET_XML_MISSING", f"worksheet XML is missing: {sheet_path}")
        try:
            with archive.open(sheet_path) as source:
                for _, element in ET.iterparse(source, events=("end",)):
                    if local_name(element.tag) != "row":
                        continue
                    row_number = int(element.attrib.get("r", "0"))
                    values: list[Any] = [None] * 30
                    for cell in element:
                        if local_name(cell.tag) != "c":
                            continue
                        column = column_number(cell.attrib.get("r", "")) - 1
                        if 0 <= column < 30:
                            values[column] = cell_value(cell, shared_strings)
                    yield row_number, values
                    element.clear()
        except ET.ParseError as exc:
            raise DryRunError("INVALID_SOURCE_SHEET_XML", f"cannot parse source worksheet: {exc}") from exc


def read_source_rows(path: Path, drawing: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str], set[tuple[str, str]]]:
    columns = drawing.get("columns", {})
    chat_rows = set(columns.get("H_聊天截图", {}).get("row_numbers", []))
    arrival_rows = set(columns.get("K_到货图_忽略", {}).get("row_numbers", []))
    refund_rows = set(columns.get("W_返款截图", {}).get("row_numbers", []))
    chat_image_count_by_row = {
        int(row): count
        for row, count in columns.get("H_聊天截图", {}).get("image_count_by_row", {}).items()
    }
    arrival_image_count_by_row = {
        int(row): count
        for row, count in columns.get("K_到货图_忽略", {}).get("image_count_by_row", {}).items()
    }
    raw_records: list[dict[str, Any]] = []
    order_to_rows: dict[tuple[str, str], list[int]] = collections.defaultdict(list)
    signatures: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    headers: list[str] | None = None
    for row_number, values in iter_source_rows(path):
        if headers is None:
            headers = [clean_text(value) for value in values]
            if headers != EXPECTED_HEADERS:
                raise DryRunError("SOURCE_HEADER_MISMATCH", "数据母表 header contract mismatch")
            continue
        if not any(clean_text(value) for value in values):
            continue
        order = classify_order_identifier(values[9])
        product = classify_product_identifier(values[5], order["marketplace_code"])
        platform_order_identifier = order["platform_order_identifier"] or order["raw_platform_order_identifier"]
        refund = classify_refund_status(
            values[19], order_number=platform_order_identifier or "", order_date=parse_source_date(values[0]),
            has_refund_date=parse_source_date(values[21]) is not None,
            has_refund_screenshot=row_number in refund_rows,
        )
        signature = row_signature(values)
        order_group_key = None
        if order["marketplace_code"] and order["platform_order_identifier"]:
            order_group_key = (order["marketplace_code"], order["platform_order_identifier"])
            order_to_rows[order_group_key].append(row_number)
            signatures[order_group_key].add(signature)
        raw_records.append({
            "row_number": row_number,
            "values": values,
            "order": order,
            "product": product,
            "order_group_key": order_group_key,
            "refund": refund,
            "chat_image_count": chat_image_count_by_row.get(row_number, 0),
            "arrival_image_count": arrival_image_count_by_row.get(row_number, 0),
            "has_refund_screenshot": row_number in refund_rows,
            "has_chat_screenshot": row_number in chat_rows,
            "has_arrival_image": row_number in arrival_rows,
        })
    if headers is None:
        raise DryRunError("SOURCE_HEADER_MISSING", "数据母表 is empty")
    exact_orders = {order for order, rows in order_to_rows.items() if len(rows) > 1 and len(signatures[order]) == 1}
    return raw_records, headers, exact_orders


def validate_manifest_invariants(records: list[dict[str, Any]]) -> None:
    for record in records:
        row_key = record["row_key"]
        order = record["order"]
        product = record["product"]
        seller = record["seller_binding"]
        chat_plan = record["chat_screenshot_plan"]
        order_marketplace = order["marketplace_code"]
        registry_blocker = marketplace_registry_blocker(order_marketplace)

        if registry_blocker:
            if record["is_production_import_eligible"]:
                raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: local-only marketplace became production eligible")
            if order["production_import_blockers"] != [registry_blocker]:
                raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: order registry blocker mismatch")
            if chat_plan and chat_plan["association_blocker"] != registry_blocker:
                raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: chat registry blocker mismatch")

        if marketplace_registry_blocker(product["marketplace_code"]) and product["production_schema_status"] != "LOCAL_CANONICAL_CANDIDATE_REGISTRY_UNSUPPORTED":
            raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: local-only product schema status mismatch")

        if order_marketplace == "JP_TIKTOK":
            provenance = product["owner_override_provenance"] or {}
            if product["manual_platform_product_identifier"] != "tiktokDLP2555Q" or provenance.get("provenance") != "OWNER_CONFIRMED":
                raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: TikTok product owner provenance mismatch")
            if seller["organization_keys"] != ["ygbceping:ls381048211"] or seller["store_relation_status"] != "OWNER_CONFIRMED_SOURCE_STORE_PHILIPS":
                raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: TikTok seller/store owner mapping mismatch")

        expected_duplicate_key = duplicate_group_key(order["order_number_key"], order["duplicate_group_size"])
        if order["duplicate_group_key"] != expected_duplicate_key:
            raise DryRunError("MANIFEST_INVARIANT_FAILED", f"{row_key}: duplicate group key does not match group size")


def build_manifest(path: Path, mapping_dir: Path, output_dir: Path) -> tuple[dict[str, Any], Path]:
    """Build the marketplace-aware manifest used by the formal dry-run entry point."""
    try:
        source_hash = sha256_file(path)
    except OSError as exc:
        raise DryRunError("SOURCE_READ_FAILED", f"cannot read source workbook: {exc}") from exc
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise DryRunError("SOURCE_SHA256_MISMATCH", f"expected {EXPECTED_SOURCE_SHA256}, got {source_hash}")
    drawing = scan_drawing(path)
    mapping, mapping_references = load_current_mapping(mapping_dir)
    records, headers, exact_orders = read_source_rows(path, drawing)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "historical-order-master-manifest.jsonl"

    order_rows: dict[tuple[str, str], list[int]] = collections.defaultdict(list)
    order_signatures: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    product_rows: collections.Counter[str] = collections.Counter()
    mapping_rows: collections.Counter[str] = collections.Counter()
    mapping_products: dict[str, set[str]] = collections.defaultdict(set)
    refund_counts: dict[str, collections.Counter[str]] = {name: collections.Counter() for name in ("buyer", "seller", "mapping", "lifecycle", "basis")}
    order_shape_counts: collections.Counter[str] = collections.Counter()
    pure_numeric_order_lengths: collections.Counter[int] = collections.Counter()
    order_marketplace_products: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    order_marketplace_product_rows: collections.Counter[str] = collections.Counter()
    order_marketplace_product_ids: dict[str, set[str]] = collections.defaultdict(set)
    legacy_invalid_order_only_chat_rows: list[dict[str, Any]] = []
    current_invalid_order_only_chat_rows: list[dict[str, Any]] = []
    row_records: list[dict[str, Any]] = []

    for item in records:
        row_number = item["row_number"]
        values = item["values"]
        order = item["order"]
        product = item["product"]
        refund = item["refund"]
        order_key = item["order_group_key"]
        pkey = product["product_key"]
        reasons = source_reasons(values, refund, order, product, order_key in exact_orders if order_key else False)
        status = "CANDIDATE" if not reasons else "QUARANTINED"
        category = mapping_category(pkey, mapping) if pkey else "INVALID_OR_MISSING_PRODUCT_IDENTIFIER"
        platform = platform_evidence(product, order)
        order_shape_counts[order["basis"]] += 1
        if re.fullmatch(r"\d+", order["raw_platform_order_identifier"]):
            pure_numeric_order_lengths[len(order["raw_platform_order_identifier"])] += 1
        if product["marketplace_code"]:
            product_marketplace = product["marketplace_code"]
            order_marketplace_product_rows[product_marketplace] += 1
            if product["platform_product_identifier"]:
                order_marketplace_products[product_marketplace][product["platform_product_identifier"]] += 1
                order_marketplace_product_ids[product_marketplace].add(product["platform_product_identifier"])

        # Recompute the previously reported 28-row review under the old
        # Amazon-only order rule, then attach the new marketplace-aware result.
        legacy_product = classify_product_identifier(values[5], None)
        legacy_reasons: list[str] = []
        if parse_source_date(values[0]) is None:
            legacy_reasons.append("MISSING_OR_INVALID_ORDER_DATE")
        if not clean_text(values[2]):
            legacy_reasons.append("MISSING_CUSTOMER_NUMBER")
        if not clean_text(values[4]):
            legacy_reasons.append("MISSING_STORE_NAME")
        if legacy_product["validation_status"] == "INVALID":
            legacy_reasons.append("MISSING_PRODUCT_IDENTIFIER" if not legacy_product["platform_product_identifier"] else "INVALID_PRODUCT_IDENTIFIER")
        if not order["raw_platform_order_identifier"]:
            legacy_reasons.append("MISSING_ORDER_NUMBER")
        elif not re.fullmatch(AMAZON_ORDER_PATTERN, order["raw_platform_order_identifier"]):
            legacy_reasons.append("INVALID_ORDER_NUMBER")
        if not compact_status(values[19]):
            legacy_reasons.append("UNMAPPED_REFUND_STATUS")
        if sorted(set(legacy_reasons)) == ["INVALID_ORDER_NUMBER"] and item["chat_image_count"]:
            legacy_invalid_order_only_chat_rows.append({
                "row_number": row_number,
                "row_key": f"historical-order-source:data-master:row:{row_number:06d}",
                "raw_order_number": order["raw_platform_order_identifier"],
                "store_name": clean_text(values[4]),
                "product_identifier": normalized_product_identifier(values[5]) or None,
                "legacy_product_key": legacy_product["product_key"],
                "chat_image_count": item["chat_image_count"],
                "new_marketplace_code": order["marketplace_code"],
                "new_platform_order_identifier": order["platform_order_identifier"],
                "new_order_basis": order["basis"],
                "resolution": "ACCEPTED_MARKETPLACE_AWARE_ORDER" if order["validation_status"] != "INVALID" else "REMAINS_UNRESOLVED",
            })
        if reasons and order["validation_status"] == "INVALID" and item["chat_image_count"] and len(reasons) == 1:
            current_invalid_order_only_chat_rows.append({
                "row_number": row_number,
                "row_key": f"historical-order-source:data-master:row:{row_number:06d}",
                "raw_order_number": order["raw_platform_order_identifier"],
                "store_name": clean_text(values[4]),
                "product_identifier": normalized_product_identifier(values[5]) or None,
                "product_key": pkey,
                "chat_image_count": item["chat_image_count"],
                **platform,
            })

        for name, value in refund.items():
            refund_counts[name][value] += 1
        if pkey is not None:
            product_rows[pkey] += 1
            mapping_rows[category] += 1
            mapping_products[category].add(pkey)
        if order_key:
            order_rows[order_key].append(row_number)
            order_signatures[order_key].add(row_signature(values))

        raw_fields = {EXPECTED_HEADERS[index]: clean_text(values[index]) for index in range(30)}
        order_entity = f"historical-order:{order['marketplace_code']}:{order['platform_order_identifier']}" if order_key else None
        order_identity_key = anonymized_key("|".join(order_key)) if order_key else None
        order_registry_blocker = marketplace_registry_blocker(order["marketplace_code"])
        owner_confirmed_tiktok_product = pkey == "JP_TIKTOK:TIKTOKDLP2555Q"
        seller_organization_keys = ["ygbceping:ls381048211"] if owner_confirmed_tiktok_product else mapping.get(pkey, {}).get("seller_organization_keys", []) if pkey else []
        seller_binding_status = "OWNER_CONFIRMED_PRODUCT_STORE_SELLER" if owner_confirmed_tiktok_product else "CANDIDATE_ONLY_NO_FORMAL_BINDING"
        store_relation_status = "OWNER_CONFIRMED_SOURCE_STORE_PHILIPS" if owner_confirmed_tiktok_product else "UNPROVEN_FROM_ORDER_ROW"
        chat_count = item["chat_image_count"]
        chat_plan = None
        if chat_count:
            association_status = "DEFER_UNTIL_FORMAL_ORDER_AND_SELLER_SCOPE" if status == "CANDIDATE" and order_entity else "ISOLATED_ROW"
            chat_plan = {
                "source_column": "H_聊天截图",
                "image_count": chat_count,
                "purpose": "ORDER_EVIDENCE_INTERNAL_COMMUNICATION",
                "business_label": "聊天截图",
                "association_status": association_status,
                "association_blocker": order_registry_blocker,
                "read_intent": "REUSE_EXISTING_SHORT_SELLER_READ_INTENT_AND_LAZY_LOAD",
                "external_write_status": "NOT_RUN",
            }
        record = {
            "row_key": f"historical-order-source:data-master:row:{row_number:06d}",
            "source": {"sheet": "数据母表", "row_number": row_number, "raw_fields": raw_fields},
            "row_status": status,
            "is_production_import_eligible": False,
            "isolation_reasons": reasons,
            "order": {
                "order_entity_key": order_entity,
                "marketplace_code": order["marketplace_code"],
                "platform_order_identifier": order["platform_order_identifier"],
                "raw_platform_order_identifier": order["raw_platform_order_identifier"] or None,
                "order_identifier_normalized": order["platform_order_identifier"],
                "order_identifier_validation_status": order["validation_status"],
                "order_identifier_basis": order["basis"],
                "production_import_blockers": [order_registry_blocker] if order_registry_blocker else [],
                "amazon_order_number": order["platform_order_identifier"] if order["marketplace_code"] == "JP_AMAZON" else None,
                "order_number_key": order_identity_key,
                "order_line_key": f"historical-order-line:{row_number:06d}",
                "line_fact_preserved": True,
                "duplicate_group_key": None,
                "duplicate_group_size": None,
                "duplicate_group_kind": None,
                "platform_evidence": platform,
            },
            "business_lifecycle": refund["lifecycle"],
            "refund": {
                "raw_status": clean_text(values[19]),
                "buyer_status": refund["buyer"],
                "seller_principal_status": refund["seller"],
                "mapping_status": refund["mapping"],
                "mapping_basis": refund["basis"],
                "refund_date": parse_source_date(values[21]),
                "has_refund_screenshot": item["has_refund_screenshot"],
                "raw_label_retained_in_provenance": True,
                "seller_principal_rate_policy": "HISTORICAL_SOURCE_SNAPSHOT_NOT_RECALCULATED_BY_0041",
            },
            "product": {
                "product_key": pkey,
                "marketplace_code": product["marketplace_code"],
                "platform_product_identifier": product["platform_product_identifier"],
                "raw_platform_product_identifier": product["raw_platform_product_identifier"],
                "manual_platform_product_identifier": product["manual_platform_product_identifier"],
                "product_identifier_validation_status": product["validation_status"],
                "product_identifier_basis": product["basis"],
                "owner_override_provenance": product["owner_override_provenance"],
                "production_schema_status": product_schema_status(product["marketplace_code"]),
                "mapping_category": category,
                "current_mapping_reference": "openspec/changes/current-reservable-product-seller-mapping/references/full-readonly-product-table-*.md" if pkey else None,
            },
            "seller_binding": {
                "status": seller_binding_status,
                "organization_keys": seller_organization_keys,
                "mapping_category": category,
                "store_relation_status": store_relation_status,
                "cross_seller_binding_guard": "REQUIRE_EXPLICIT_SELLER_ORGANIZATION_AND_STORE_SCOPE_BEFORE_ATTACH_OR_READ",
            },
            "chat_screenshot_plan": chat_plan,
            "ignored_images": {"K_到货图": {"image_count": item["arrival_image_count"], "policy": "IGNORE_DO_NOT_MODEL_DO_NOT_IMPORT"}} if item["arrival_image_count"] else None,
        }
        row_records.append(record)

    for record in row_records:
        order = record["order"]
        order_key = (order["marketplace_code"], order["platform_order_identifier"]) if order["marketplace_code"] and order["platform_order_identifier"] else None
        if order_key and order_key in order_rows:
            group_rows = order_rows[order_key]
            record["order"]["duplicate_group_size"] = len(group_rows)
            record["order"]["duplicate_group_kind"] = "EXACT_SOURCE_FACTS" if len(order_signatures[order_key]) == 1 and len(group_rows) > 1 else "CONFLICTING_SOURCE_FACTS" if len(group_rows) > 1 else "UNIQUE"
            record["order"]["duplicate_group_key"] = duplicate_group_key(order["order_number_key"], len(group_rows))

    validate_manifest_invariants(row_records)
    with manifest_path.open("w", encoding="utf-8") as destination:
        for record in row_records:
            destination.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    manifest_hash = sha256_file(manifest_path)
    chat = drawing.get("columns", {}).get("H_聊天截图", {})
    arrival = drawing.get("columns", {}).get("K_到货图_忽略", {})
    candidate_rows = sum(1 for record in row_records if record["row_status"] == "CANDIDATE")
    quarantined_rows = len(row_records) - candidate_rows

    product_distribution: dict[str, Any] = {}
    for marketplace in sorted(order_marketplace_product_rows):
        identifiers = order_marketplace_products[marketplace]
        product_distribution[marketplace] = {
            "rows_with_platform_assignment": order_marketplace_product_rows[marketplace],
            "nonblank_unique_identifiers": len(order_marketplace_product_ids[marketplace]),
            "blank_identifier_rows": sum(1 for item in records if item["product"]["marketplace_code"] == marketplace and not item["product"]["platform_product_identifier"]),
            "identifier_length_counts": dict(sorted(collections.Counter(len(identifier) for identifier in order_marketplace_product_ids[marketplace]).items())),
            "top_identifiers_by_rows": [{"identifier": identifier, "rows": count} for identifier, count in identifiers.most_common(20)],
        }

    summary = {
        "status": "LOCAL_READONLY_DRY_RUN",
        "source": {"path": str(path), "sha256": source_hash, "size_bytes": path.stat().st_size, "sheet": "数据母表", "excluded_sheets": ["进线出单统计", "进线总计"], "headers_match": headers == EXPECTED_HEADERS},
        "parser": {"implementation": "PYTHON_STDLIB_XLSX_ZIP_XML", "third_party_dependencies": [], "media_bytes_opened": 0},
        "manifest": {"path": str(manifest_path), "sha256": manifest_hash, "records": len(row_records), "stable_row_key": "historical-order-source:data-master:row:<6-digit source row>"},
        "conservation": {"source_rows": len(row_records), "candidate_rows": candidate_rows, "quarantined_rows": quarantined_rows, "candidate_plus_quarantined": candidate_rows + quarantined_rows, "conserved": candidate_rows + quarantined_rows == len(row_records)},
        "orders": {
            "valid_order_rows": sum(len(rows) for rows in order_rows.values()),
            "unique_valid_platform_orders": len(order_rows),
            "unique_valid_order_numbers": len({key[1] for key in order_rows}),
            "orders_by_marketplace": {marketplace: {"rows": sum(len(rows) for key, rows in order_rows.items() if key[0] == marketplace), "unique_platform_orders": sum(1 for key in order_rows if key[0] == marketplace)} for marketplace in sorted({key[0] for key in order_rows})},
            "duplicate_platform_order_groups": sum(1 for rows in order_rows.values() if len(rows) > 1),
            "duplicate_platform_order_rows": sum(len(rows) for rows in order_rows.values() if len(rows) > 1),
            "duplicate_exact_groups": sum(1 for order, rows in order_rows.items() if len(rows) > 1 and len(order_signatures[order]) == 1),
            "duplicate_conflicting_groups": sum(1 for order, rows in order_rows.items() if len(rows) > 1 and len(order_signatures[order]) > 1),
            "order_shape_evidence": dict(sorted(order_shape_counts.items())),
            "tiktok_rule": {"pattern": TIKTOK_ORDER_PATTERN, "basis": "OWNER_RULE_TIKTOK_585_PREFIX_18_DIGIT_ORDER_SHAPE", "accepted_rows": order_shape_counts["OWNER_RULE_TIKTOK_585_PREFIX_18_DIGIT_ORDER_SHAPE"], "pure_numeric_length_counts": {str(length): count for length, count in sorted(pure_numeric_order_lengths.items())}, "pure_numeric_unrecognized_rows": sum(count for length, count in pure_numeric_order_lengths.items() if length != 18)},
        },
        "products": {"valid_product_rows": sum(product_rows.values()), "unique_valid_product_keys": len(product_rows), "amazon_unique": sum(1 for key in product_rows if key.startswith("JP_AMAZON:")), "rakuten_unique": sum(1 for key in product_rows if key.startswith("JP_RAKUTEN:")), "tiktok_unique_local_candidates": sum(1 for key in product_rows if key.startswith("JP_TIKTOK:")), "mapping_categories": {category: {"unique_products": len(mapping_products[category]), "rows": mapping_rows[category]} for category in sorted(mapping_products)}, "platform_product_identifier_distribution": product_distribution, "tiktok_schema_decision": "LOCAL_CANDIDATE_SCHEMA_DECISION_REQUIRED_FORMAL_ENUM_NOT_ASSUMED", "marketplace_registry": {"currently_supported": ["AMAZON_JP", "AMAZON_US", "COUPANG_KR"], "local_only_candidates": ["JP_RAKUTEN", "JP_TIKTOK"], "production_import_blocker": "INDEPENDENT_MARKETPLACE_SCHEMA_API_UI_MIGRATION_DECISION_REQUIRED"}},
        "refund": {"buyer_status_counts": dict(sorted(refund_counts["buyer"].items())), "seller_status_counts": dict(sorted(refund_counts["seller"].items())), "mapping_status_counts": dict(sorted(refund_counts["mapping"].items())), "lifecycle_status_counts": dict(sorted(refund_counts["lifecycle"].items())), "mapping_basis_counts": dict(sorted(refund_counts["basis"].items())), "date_prefix_treatment": "raw_label_only_not_imported_as_payment_date"},
        "images": {"chat_screenshot_H": {"image_count": chat.get("image_count", 0), "unique_rows": chat.get("unique_row_count", 0), "candidate_rows_with_chat": sum(1 for record in row_records if record["row_status"] == "CANDIDATE" and record["chat_screenshot_plan"]), "quarantined_rows_with_chat": sum(1 for record in row_records if record["row_status"] == "QUARANTINED" and record["chat_screenshot_plan"]), "association_planned": sum(record["chat_screenshot_plan"]["image_count"] for record in row_records if record["chat_screenshot_plan"] and record["chat_screenshot_plan"]["association_status"] == "DEFER_UNTIL_FORMAL_ORDER_AND_SELLER_SCOPE"), "association_isolated": sum(record["chat_screenshot_plan"]["image_count"] for record in row_records if record["chat_screenshot_plan"] and record["chat_screenshot_plan"]["association_status"] != "DEFER_UNTIL_FORMAL_ORDER_AND_SELLER_SCOPE"), "conserved": sum(record["chat_screenshot_plan"]["image_count"] for record in row_records if record["chat_screenshot_plan"]) == chat.get("image_count", 0)}, "arrival_image_K": {"image_count": arrival.get("image_count", 0), "policy": "IGNORE_DO_NOT_MODEL_DO_NOT_IMPORT"}},
        "current_mapping_evidence": {"reference_files": mapping_references, "products_in_evidence": len(mapping), "mapped_products": sum(1 for item in mapping.values() if item["status"] == "MAPPED"), "unresolved_products": sum(1 for item in mapping.values() if item["status"] != "MAPPED")},
        "invalid_order_only_chat_review": {
            "legacy_before_marketplace_aware_rules": {"rows": sorted(legacy_invalid_order_only_chat_rows, key=lambda item: item["row_number"]), "total_rows": len(legacy_invalid_order_only_chat_rows), "by_new_marketplace": dict(sorted(collections.Counter(item["new_marketplace_code"] or "UNRESOLVED" for item in legacy_invalid_order_only_chat_rows).items())), "by_resolution": dict(sorted(collections.Counter(item["resolution"] for item in legacy_invalid_order_only_chat_rows).items()))},
            "current_unrecognized_order_only_chat": {"rows": sorted(current_invalid_order_only_chat_rows, key=lambda item: item["row_number"]), "total_rows": len(current_invalid_order_only_chat_rows), "by_conclusion": dict(sorted(collections.Counter(item["conclusion"] for item in current_invalid_order_only_chat_rows).items()))},
            "policy": "The former 28-row review is recomputed from source facts; confirmed Rakuten, TikTok-shaped and normalized Amazon identifiers are not quarantined for Amazon-only shape failure."
        },
        "financial_boundary": {"seller_principal_policy": "PRESERVE_HISTORICAL_SOURCE_FACTS_AND_PROVENANCE", "migration_0041": "NOT_EXECUTED", "recalculate_by_current_policy": False, "independent_historical_financial_storage_decision": "DEFER_TO_CONTROL_REVIEW"},
        "migration": {"decision": "NO_MIGRATION_IN_THIS_LOCAL_CHANGE", "production_import": "NOT_EXECUTED", "idempotency": "future_import_requires_source_hash_and_row_key_upsert_guard", "rollback": "future_import_requires_pre-import_batch_marker_and_reversible_batch_scope", "resume": "future_import_requires_row_key_checkpoint_and_deterministic_replay", "duplicate_orders": "preserve_marketplace_aware_order_lines_and_exact-duplicate-quarantine", "duplicate_images": "future_import_requires_source-row-and-image-fingerprint-guard", "cross_seller": "reject_without_explicit_current_seller_organization_and_store_scope"},
        "external_writes": {"external_calls": 0, "tencent_docs_writes": 0, "database_writes": 0, "r2_writes": 0, "image_bytes_extracted": 0, "migrations_run": 0, "deployments": 0},
        "quarantine_reason_counts": dict(sorted(collections.Counter(reason for record in row_records for reason in record["isolation_reasons"]).items())),
    }
    summary_path = output_dir / "historical-order-master-dry-run.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary["manifest"]["summary_path"] = str(summary_path)
    return summary, manifest_path


def write_negative_xlsx(path: Path, headers: list[str]) -> None:
    shared_strings = "".join(
        f"<si><t>{escape(value)}</t></si>"
        for value in headers
    )
    cells = "".join(
        f'<c r="{column_letters(index + 1)}1" t="s"><v>{index}</v></c>'
        for index in range(len(headers))
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="数据母表" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData><row r="1">{cells}</row></sheetData></worksheet>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", relationships)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
        archive.writestr("xl/sharedStrings.xml", f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{shared_strings}</sst>')


def run_negative_tests() -> None:
    with tempfile.TemporaryDirectory(prefix="historical-order-negative-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        try:
            build_manifest(temporary_path / "missing.xlsx", Path("."), temporary_path / "output")
        except DryRunError as error:
            assert error.code == "SOURCE_READ_FAILED"
        else:  # pragma: no cover - assertion guard
            raise AssertionError("missing source must fail structurally")

        drift_path = temporary_path / "drift.xlsx"
        drift_path.write_bytes(b"not-the-frozen-workbook")
        try:
            build_manifest(drift_path, Path("."), temporary_path / "output")
        except DryRunError as error:
            assert error.code == "SOURCE_SHA256_MISMATCH"
        else:  # pragma: no cover - assertion guard
            raise AssertionError("source drift must fail structurally")
        entry = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--source", str(drift_path), "--output-dir", str(temporary_path / "entry-output")],
            capture_output=True,
            text=True,
            check=False,
        )
        entry_error = json.loads(entry.stderr)
        assert entry.returncode == 1
        assert entry_error["status"] == "LOCAL_READONLY_DRY_RUN_FAILED"
        assert entry_error["error_code"] == "SOURCE_SHA256_MISMATCH"
        assert entry_error["external_writes"] == 0
        assert "Traceback" not in entry.stderr

        header_path = temporary_path / "header-drift.xlsx"
        write_negative_xlsx(header_path, EXPECTED_HEADERS[:-1] + ["漂移表头"])
        try:
            read_source_rows(header_path, {"columns": {}})
        except DryRunError as error:
            assert error.code == "SOURCE_HEADER_MISMATCH"
        else:  # pragma: no cover - assertion guard
            raise AssertionError("header drift must fail structurally")
    assert classify_refund_status("", order_number="", order_date="2025-12-31", has_refund_date=False, has_refund_screenshot=False) == {"buyer": "REFUNDED", "seller": "REFUNDED", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE_DATE_CUTOFF"}
    assert classify_refund_status("", order_number="", order_date="2026-01-01", has_refund_date=False, has_refund_screenshot=False) == {"buyer": "PENDING", "seller": "PENDING", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE_DATE_CUTOFF"}
    assert classify_refund_status("", order_number="", order_date=None, has_refund_date=False, has_refund_screenshot=False)["mapping"] == "MAPPED"
    assert classify_refund_status("催评", order_number="", order_date="2026-01-01", has_refund_date=False, has_refund_screenshot=False) == {"buyer": "PENDING", "seller": "PENDING", "mapping": "MAPPED", "lifecycle": "ACTIVE", "basis": "OWNER_RULE"}
    assert classify_refund_status("8-7-待返款", order_number="", order_date="2026-01-01", has_refund_date=True, has_refund_screenshot=True)["buyer"] == "REFUNDED"
    assert classify_refund_status("待返款, 卖家未返款", order_number="", order_date="2026-01-01", has_refund_date=True, has_refund_screenshot=True)["seller"] == "PENDING"
    assert classify_refund_status("待返款", order_number="", order_date="2026-01-01", has_refund_date=False, has_refund_screenshot=False)["seller"] == "REFUNDED"
    values = ["2026年1月1日", "", "C", "wx", "store", "B0ABC12345", "1", "", "", "503-0000000-0000000", "", "", "", "", "", "", "", "", "", "已返款", "", "", "", "", "", "", "", "", "", ""]
    negative_order = classify_order_identifier(values[9])
    negative_product = classify_product_identifier(values[5], negative_order["marketplace_code"])
    reasons = source_reasons(values, classify_refund_status(values[19], order_number=values[9], order_date=parse_source_date(values[0]), has_refund_date=False, has_refund_screenshot=False), negative_order, negative_product, True)
    assert "EXACT_DUPLICATE_SOURCE_FACTS" in reasons
    assert mapping_category("JP_AMAZON:B0ABC12345", {"JP_AMAZON:B0ABC12345": {"status": "MAPPED", "seller_organization_keys": ["seller-a", "seller-b"]}}) == "CURRENT_PRODUCT_MULTI_SELLER_AMBIGUOUS"
    assert classify_order_identifier("390413-20220906-0184936914")["marketplace_code"] == "JP_RAKUTEN"
    assert classify_order_identifier("585211100323087771")["basis"] == "OWNER_RULE_TIKTOK_585_PREFIX_18_DIGIT_ORDER_SHAPE"
    assert classify_order_identifier("24943883717174241")["validation_status"] == "INVALID"
    normalized = classify_order_identifier("250-30129454821465")
    assert normalized["platform_order_identifier"] == "250-3012945-4821465"
    assert normalized["basis"] == "NORMALIZED_MISSING_SEPARATOR"
    override = classify_product_identifier("", "JP_TIKTOK")
    assert override["product_key"] == "JP_TIKTOK:TIKTOKDLP2555Q"
    assert override["manual_platform_product_identifier"] == "tiktokDLP2555Q"
    assert override["owner_override_provenance"]["provenance"] == "OWNER_CONFIRMED"
    assert marketplace_registry_blocker("JP_RAKUTEN") == "MARKETPLACE_REGISTRY_UNSUPPORTED_JP_RAKUTEN"
    assert marketplace_registry_blocker("JP_TIKTOK") == "MARKETPLACE_REGISTRY_UNSUPPORTED_JP_TIKTOK"
    assert marketplace_registry_blocker("JP_AMAZON") is None
    assert product_schema_status("JP_RAKUTEN") == "LOCAL_CANONICAL_CANDIDATE_REGISTRY_UNSUPPORTED"
    assert product_schema_status("JP_TIKTOK") == "LOCAL_CANONICAL_CANDIDATE_REGISTRY_UNSUPPORTED"
    assert duplicate_group_key("order-key", 1) is None
    assert duplicate_group_key("order-key", 2) == "order-key"
    assert duplicate_group_key(None, 2) is None
    print(json.dumps({"status": "NEGATIVE_TESTS_PASS", "cases": ["missing_source", "source_sha256_drift", "structured_entry_failure", "header_drift", "refund_mapping", "refund_blank_date_cutoff", "prompt_review_mapping", "duplicate_quarantine", "multi_seller_guard", "rakuten_order_shape", "tiktok_order_shape", "tiktok_outlier_rejection", "amazon_missing_separator_normalization", "tiktok_owner_product_override", "rakuten_registry_blocker", "tiktok_registry_blocker", "unique_duplicate_group_key_null", "repeated_duplicate_group_key_present"], "external_writes": 0}, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("/Users/yueguangbai/Downloads/数据订单汇总.xlsx"))
    parser.add_argument("--mapping-dir", type=Path, default=Path(__file__).resolve().parents[1] / "openspec/changes/current-reservable-product-seller-mapping/references")
    parser.add_argument("--output-dir", type=Path, default=Path("tmp/historical-order-master-migration"))
    parser.add_argument("--negative-tests", action="store_true")
    args = parser.parse_args()
    if args.negative_tests:
        run_negative_tests()
        return 0
    summary, manifest_path = build_manifest(args.source, args.mapping_dir, args.output_dir)
    print(json.dumps({"status": summary["status"], "manifest": str(manifest_path), "summary": summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        code = exc.code if isinstance(exc, DryRunError) else "LOCAL_DRY_RUN_ERROR"
        print(json.dumps({"status": "LOCAL_READONLY_DRY_RUN_FAILED", "error_code": code, "error": str(exc), "external_writes": 0}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
