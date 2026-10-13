"""标注结构检查；不把空标注推断成漏标，也不推断语义质量。"""
import json
import math
from collections import Counter, defaultdict


def invalid_geometry(raw, annotation_type):
    try:
        data = json.loads(raw)
        if annotation_type == 'segmentation':
            points = data['points']
            return len(points) < 3 or any(len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in p) for p in points)
        x, y, w, h = (data[k] for k in ('x_center', 'y_center', 'width', 'height'))
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in (x, y, w, h)):
            return True
        return not (w > 0 and h > 0 and x-w/2 >= -1e-6 and y-h/2 >= -1e-6 and x+w/2 <= 1+1e-6 and y+h/2 <= 1+1e-6)
    except (ValueError, TypeError, KeyError, IndexError):
        return True


def summarize(categories, images, annotations, annotation_type):
    counts = Counter()
    class_images = defaultdict(set)
    annotated = set()
    invalid = []
    bad_count = 0
    category_ids = {c.id for c in categories}
    for ann in annotations:
        annotated.add(ann.image_id)
        counts[ann.category_id] += 1
        class_images[ann.category_id].add(ann.image_id)
        if ann.category_id not in category_ids or invalid_geometry(ann.bbox_data, annotation_type):
            bad_count += 1
            if len(invalid) < 100:
                invalid.append({'image_id': ann.image_id, 'annotation_id': ann.id})
    empty = [image.id for image in images if image.id not in annotated]
    mismatch = sum(bool(image.is_annotated) != (image.id in annotated) for image in images)
    return {'total_images': len(images), 'annotated_images': len(annotated), 'empty_images': len(empty),
            'empty_image_examples': empty[:100], 'annotation_count': sum(counts.values()),
            'invalid_annotations': bad_count, 'invalid_examples': invalid, 'annotation_flag_mismatch': mismatch,
            'categories': [{'id': c.id, 'name': c.name, 'instances': counts[c.id], 'images': len(class_images[c.id])} for c in categories],
            'note': '空标注可能是正常负样本或尚未标注；结构检查不能判断漏标、错类、拍摄质量和数据集泄漏。'}
