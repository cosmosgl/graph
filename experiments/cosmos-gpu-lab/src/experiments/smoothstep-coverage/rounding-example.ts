// A possible calculation, not a claim about either driver's implementation.
// The weights describe the sample inside the ideal, 512 × 512 control triangle.
const values = [0.5, -0.5, -0.5]
const f = Math.fround

function weightedPosition (weights: number[]): number {
  const terms = weights.map((weight, i) => f(weight * values[i]))
  return f(f(terms[0] + terms[1]) + terms[2])
}

export function roundingExample (length = 180): { direct: number; sharedReciprocal: number; reciprocal: number } {
  const denominator = 4 * length
  const numerators = [length / 2, 4 * (length - 60.5), 242 - length / 2]
  const directWeights = numerators.map(n => f(n / denominator))
  const reciprocal = f(1 / denominator)
  const multipliedWeights = numerators.map(n => f(n * reciprocal))
  return { direct: weightedPosition(directWeights), sharedReciprocal: weightedPosition(multipliedWeights), reciprocal }
}
