import * as tf from '@tensorflow/tfjs';
import { zip } from 'lodash';
import { reshape, validateFitInputs, validateMatrix2D } from '../ops';
import { IMlModel, Type1DMatrix, Type2DMatrix } from '../types';

const SQRT_2PI = Math.sqrt(Math.PI * 2);

/**
 * The Naive is an intuitive method that uses probabilistic of each attribute
 * being in each class to make a prediction. It uses Gaussian function to estimate
 * probability of a given class.
 *
 * @example
 * import { GaussianNB } from 'kalimdor/naive_bayes';
 *
 * const nb = new GaussianNB();
 * const X = [[1, 20], [2, 21], [3, 22], [4, 22]];
 * const y = [1, 0, 1, 0];
 * nb.fit({ X, y });
 * nb.predict({ X: [[1, 20]] }); // returns [ 1 ]
 *
 */
export class GaussianNB<T extends number | string = number>
  implements IMlModel<T> {
  private classCategories: T[];
  private mean: tf.Tensor2D;
  private variance: tf.Tensor2D;

  /**
   * @param  {Type2DMatrix<number>=null} X - array-like or sparse matrix of shape = [n_samples, n_features]
   * @param  {Type1DMatrix<T>=null} y - array-like, shape = [n_samples] or [n_samples, n_outputs]
   * @returns void
   */
  public fit(X: Type2DMatrix<number> = null, y: Type1DMatrix<T> = null): void {
    validateFitInputs(X, y);
    const { classCategories, mean, variance } = this.fitModel(X, y);
    this.classCategories = classCategories;
    this.mean = mean;
    this.variance = variance;
  }

  /**
   * @param  {Type2DMatrix<number>} X
   * @returns T
   */
  public predict(X: Type2DMatrix<number>): T[] {
    validateMatrix2D(X);
    return X.map((x): T => this.singlePredict(x));
  }

  /**
   * @returns InterfaceFitModel
   */
  public model(): {
    classCategories: T[];
    mean: tf.Tensor2D;
    variance: tf.Tensor2D;
  } {
    return {
      classCategories: this.classCategories,
      mean: this.mean,
      variance: this.variance
    };
  }

  /**
   * @param  {IterableIterator<IterableIterator<number>>} X
   * @returns IterableIterator
   */
  public *predictIterator(
    X: IterableIterator<IterableIterator<number>>
  ): IterableIterator<T> {
    for (const x of X) {
      yield this.singlePredict([...x]);
    }
  }

  /**
   * @param  {InterfaceFitModelAsArray<T>} modelState
   * @returns void
   */
  public fromJSON(modelState: {
    classCategories: T[];
    mean: Type2DMatrix<number>;
    variance: Type2DMatrix<number>;
  }): void {
    this.classCategories = modelState.classCategories;
    this.mean = tf.tensor2d(modelState.mean);
    this.variance = tf.tensor2d(modelState.variance);
  }

  /**
   * Returns a model checkpoint
   *
   * @returns InterfaceFitModelAsArray
   */
  public toJSON(): {
    classCategories: T[];
    mean: Type2DMatrix<number>;
    variance: Type2DMatrix<number>;
  } {
    return {
      classCategories: this.classCategories,
      mean: reshape([...this.mean.dataSync()], this.mean.shape) as Type2DMatrix<
        number
      >,
      variance: reshape(
        [...this.variance.dataSync()],
        this.variance.shape
      ) as Type2DMatrix<number>
    };
  }

  /**
   * Make a prediction
   *
   * @param  {ReadonlyArray<number>} X- values to predict in Matrix format
   * @returns T
   */
  private singlePredict(X: ReadonlyArray<number>): T {
    const matrixX: tf.Tensor<tf.Rank> = tf.tensor1d(X as number[], 'float32');
    const numFeatures = matrixX.shape[0];

    // Comparing input and summary shapes
    const summaryLength = this.mean.shape[1];
    if (numFeatures !== summaryLength) {
      throw new Error(
        `Prediction input ${
          matrixX.shape[0]
        } length must be equal or less than summary length ${summaryLength}`
      );
    }

    const mean = this.mean.clone();
    const variance = this.variance.clone();

    const meanValPow: tf.Tensor<tf.Rank> = matrixX
      .sub(mean)
      .pow(tf.scalar(2))
      .mul(tf.scalar(-1));

    const exponent: tf.Tensor<tf.Rank> = meanValPow
      .div(variance.mul(tf.scalar(2)))
      .exp();
    const innerDiv: tf.Tensor<tf.Rank> = tf
      .scalar(SQRT_2PI)
      .mul(variance.sqrt());
    const probabilityArray: tf.Tensor<tf.Rank> = tf
      .scalar(1)
      .div(innerDiv)
      .mul(exponent);

    const selectionIndex = probabilityArray
      .prod(1)
      .argMax()
      .dataSync()[0];

    return this.classCategories[selectionIndex];
  }

  /**
   * Summarise the dataset per class using "probability density function"
   *
   * @param  {Type2DMatrix<number>} X
   * @param  {ReadonlyArray<T>} y
   * @returns InterfaceFitModel
   */
  private fitModel(
    X: Type2DMatrix<number>,
    y: Type1DMatrix<T>
  ): {
    classCategories: T[];
    mean: tf.Tensor2D;
    variance: tf.Tensor2D;
  } {
    const classCategories = [...new Set(y)].sort() as T[];

    // Separates X by classes specified by y argument
    const separatedByCategory: {
      [key: string]: Type2DMatrix<number>;
    } = zip<ReadonlyArray<number>, T>(X, y).reduce(
      (groups, [row, category]) => {
        groups[category.toString()] = groups[category.toString()] || [];
        groups[category.toString()].push(row);
        return groups;
      },
      {}
    );

    const momentStack = classCategories.map((category: T) => {
      const classFeatures: tf.Tensor = tf.tensor2d(
        separatedByCategory[category.toString()] as number[][],
        null,
        'float32'
      ) as tf.Tensor;
      return tf.moments(classFeatures, [0]);
    });

    // For every class we have a mean and variance for each feature
    const mean: tf.Tensor2D = tf.stack(
      momentStack.map(m => m.mean)
    ) as tf.Tensor2D;
    const variance: tf.Tensor2D = tf.stack(
      momentStack.map(m => m.variance)
    ) as tf.Tensor2D;

    // TODO check for NaN or 0 variance
    // setTimeout(() => {
    //   if ([...variance.dataSync()].some(i => i === 0)) {
    //     console.error('No variance on one of the features. Errors may result.');
    //   }
    // }, 100);

    return {
      classCategories,
      mean,
      variance
    };
  }
}
