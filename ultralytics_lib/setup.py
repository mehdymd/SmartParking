from setuptools import setup, find_packages

setup(
    name="ultralytics-like",
    version="0.1.0",
    description="A library similar to Ultralytics YOLO for computer vision tasks",
    packages=find_packages(),
    install_requires=[
        "torch",
        "torchvision",
        "opencv-python",
        "numpy",
        "pillow",
    ],
    entry_points={
        'console_scripts': [
            'ultralytics-like = ultralytics.cli:main',
        ],
    },
)
