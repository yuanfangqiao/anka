"""
calculator 插件后端：CalculatorService（Service 类，provide=['calculator']）

前端只发表达式字符串，计算在后端完成：
  snapshot()   → GET  /api/apps/calculator/state   （历史记录）
  calc(expr)   → POST /api/apps/calculator/call     （求值并记入历史）

用 ast 解析 + 白名单节点遍历求值，不使用 eval（拒绝任意代码注入）。
"""

import ast
import operator

from app.cordis import Service

name = 'calculator'
provide = ['calculator']

# 白名单：允许的二元运算与一元运算
_BIN = {
    ast.Add: operator.add, ast.Sub: operator.sub,
    ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def safe_eval(expr: str) -> float:
    """AST 白名单求值：仅支持数字与 + - * / // % ** 和括号"""
    tree = ast.parse(expr, mode='eval')

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return _BIN[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](walk(node.operand))
        raise ValueError(f'不支持的表达式元素: {type(node).__name__}')

    result = walk(tree)
    if isinstance(result, float) and result.is_integer():
        result = int(result)     # 3.0 → 3，显示更自然
    return result


class CalculatorService(Service):
    """计算器：后端求值 + 保留最近 10 条历史"""

    def __init__(self, ctx):
        super().__init__(ctx, 'calculator')
        self._history: list[dict] = []

    def snapshot(self) -> dict:
        return {'history': self._history}

    def calc(self, expr: str) -> dict:
        expr = (expr or '').strip()
        if not expr:
            raise ValueError('表达式为空')
        if len(expr) > 100:
            raise ValueError('表达式过长')
        try:
            value = safe_eval(expr) * 10
        except SyntaxError:
            raise ValueError('表达式语法错误')
        entry = {'expr': expr, 'result': str(value)}
        self._history.insert(0, entry)
        del self._history[10:]          # 只保留最近 10 条
        return entry

    def clear(self) -> bool:
        self._history = []
        return True
