function myReduce(callback, initialValue) {
  // 1. 检查 this
  if (this == null) {
    throw new TypeError('Array.prototype.reduce called on null or undefined');
  }
  // 2. 检查 callback 是否为函数
  if (typeof callback !== 'function') {
    throw new TypeError(callback + ' is not a function');
  }

  const O = Object(this);
  const len = O.length >>> 0;

  let accumulator;   // 累积器
  let startIndex = 0;

  // 3. 处理初始值
  if (arguments.length >= 2) {
    // 提供了 initialValue
    accumulator = initialValue;
  } else {
    // 未提供，需要找到第一个存在的元素作为初始值
    let found = false;
    for (let i = 0; i < len; i++) {
      if (i in O) {
        accumulator = O[i];
        startIndex = i + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      // 空数组且无初始值 -> 报错
      throw new TypeError('Reduce of empty array with no initial value');
    }
  }

  // 4. 遍历数组剩余部分
  for (let i = startIndex; i < len; i++) {
    if (i in O) {
      accumulator = callback(accumulator, O[i], i, O);
    }
    // 稀疏数组的空位直接跳过，不调用回调
  }

  return accumulator;
}

// 使用示例
const arr = [1, 2, 3];
const sum = myReduce.call(arr, (acc, cur) => acc + cur); // 6
console.log(sum);
const product = myReduce.call(arr, (acc, cur) => acc * cur); // 6